$ErrorActionPreference = "Stop"
$base = "http://localhost:3311"
$trip = "11111111-1111-4111-8111-111111111111"
$script:results = @()
$script:tempFiles = @()

function Log($name, $ok, $detail) {
    $script:results += [pscustomobject]@{ Check = $name; Ok = $ok; Detail = $detail }
    $mark = if ($ok) { "PASS" } else { "FAIL" }
    Write-Host "[$mark] $name :: $detail"
}

function BodyFile($obj) {
    $p = Join-Path $env:TEMP ("smoke-" + [guid]::NewGuid().ToString("N") + ".json")
    [IO.File]::WriteAllText($p, ($obj | ConvertTo-Json -Depth 8 -Compress), (New-Object Text.UTF8Encoding($false)))
    $script:tempFiles += $p
    return $p
}

# 用 curl.exe 发请求（PS 5.1 的 Invoke-RestMethod 对 byte[] body 有编码坑）。
# 返回 { code, json }；json 在响应不是 JSON 时为 $null。
function Req($method, $url, $obj, $extraHeaders = @{}) {
    $curlArgs = @("-s", "-w", "`n%{http_code}", "-X", $method)
    if ($null -ne $obj) {
        $f = BodyFile $obj
        $curlArgs += @("-H", "content-type: application/json", "--data-binary", "@$f")
    }
    foreach ($k in $extraHeaders.Keys) { $curlArgs += @("-H", "$k`: $($extraHeaders[$k])") }
    $curlArgs += ($base + $url)
    $out = & curl.exe @curlArgs
    $lines = @($out -split "`n") | ForEach-Object { $_.TrimEnd("`r") }
    $code = [int]($lines[-1])
    $body = ($lines[0..($lines.Length - 2)] -join "`n")
    $json = $null
    try { $json = $body | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ code = $code; body = $body; json = $json }
}

# ---------- 0. 健康检查 ----------
$h = Req "GET" "/api/health" $null
Log "health.dataMode" ($h.code -eq 200 -and $h.json.dataMode -eq "memory") "dataMode=$($h.json.dataMode)"

# ---------- 1. 页面渲染 ----------
foreach ($p in @("/", "/trips/$trip", "/trips/$trip/expenses", "/trips/$trip/insights", "/trips/$trip/settings", "/trips/new", "/login")) {
    $r = Req "GET" $p $null
    # 演示模式只有一个行程时 / 会按设计 307 跳到行程页
    $ok = $r.code -eq 200 -or ($p -eq "/" -and $r.code -eq 307)
    Log "GET $p" $ok "status=$($r.code)"
}

# ---------- 2. 解析：符号前缀金额（demo 今天在巴黎段，默认 EUR；符号必须胜出） ----------
$cap = Req "POST" "/api/capture" @{ tripId = $trip; transcript = "hotel deposit ¥3000" }
$d0 = $cap.json.drafts[0]
Log "capture ¥3000 => 3000 CNY" ($d0.amount -eq 3000 -and $d0.currency -eq "CNY") "amount=$($d0.amount) currency=$($d0.currency)"

$cap2 = Req "POST" "/api/capture" @{ tripId = $trip; transcript = "午饭 15，地铁 3" }
Log "capture 未提币种 => 分段默认 EUR" ($cap2.json.drafts.Count -eq 2 -and $cap2.json.drafts[0].currency -eq "EUR") "count=$($cap2.json.drafts.Count) c0=$($cap2.json.drafts[0].currency)"

$capK = Req "POST" "/api/capture" @{ tripId = $trip; transcript = "购物 1.2万日元" }
Log "capture 中文数字+万 => 12000 JPY" ($capK.json.drafts[0].amount -eq 12000 -and $capK.json.drafts[0].currency -eq "JPY") "amount=$($capK.json.drafts[0].amount) currency=$($capK.json.drafts[0].currency)"

# ---------- 3. 落库 + 部分更新不丢字段 ----------
$today = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
$created = Req "POST" "/api/expenses" @{ tripId = $trip; expenses = @(@{ amount = 3000; currency = "CNY"; categoryKey = "lodging"; merchant = "Smoke Hotel"; note = "押金"; paymentMethod = "card"; source = "voice"; spentOn = $today }) }
$eid = $created.json.expenses[0].id
Log "expenses POST" ($created.code -eq 200 -and $created.json.expenses[0].baseAmount -gt 0) "baseAmount=$($created.json.expenses[0].baseAmount)"

$patched = Req "PATCH" "/api/expenses/$eid" @{ id = $eid; amount = 3100 }
$pe = $patched.json.expense
Log "PATCH 改金额不清空 merchant/category" ($pe.merchant -eq "Smoke Hotel" -and $pe.categoryKey -eq "lodging" -and $pe.amount -eq 3100) "merchant=$($pe.merchant) cat=$($pe.categoryKey) amount=$($pe.amount)"

# ---------- 4. 纠错意图定位最近一笔 ----------
$cap3 = Req "POST" "/api/capture" @{ tripId = $trip; transcript = "刚才那笔改成 18 镑" }
Log "capture 纠错意图" ($cap3.json.intent -eq "correct" -and $null -ne $cap3.json.target) "intent=$($cap3.json.intent) target=$($cap3.json.target.id)"

# ---------- 5. 未来日期被钳制到今天 ----------
$created2 = Req "POST" "/api/expenses" @{ tripId = $trip; expenses = @(@{ amount = 5; currency = "EUR"; categoryKey = "food"; spentOn = "2027-01-01" }) }
$clamped = $created2.json.expenses[0].spentOn
Log "未来日期落库被钳制" ("$clamped" -le "$today") "spentOn=$clamped today=$today"

# ---------- 6. 预算替换 + 分段校验 ----------
$put = Req "PUT" "/api/trips/$trip/budgets" @{ budgets = @(@{ currency = "GBP"; amount = 1000; label = "英镑现金" }, @{ currency = "CNY"; amount = 10000; label = "人民币备用" }) }
Log "budgets PUT" ($put.code -eq 200 -and $put.json.budgets.Count -eq 2) "count=$($put.json.budgets.Count)"

# 演示行程日期随「今天」滚动，分段日期必须从实际行程推导
$trips = Req "GET" "/api/trips" $null
$demo = $trips.json.trips | Where-Object { $_.id -eq $trip } | Select-Object -First 1
function AddDays($iso, $n) {
    $d = [datetime]::ParseExact($iso, "yyyy-MM-dd", $null).ToUniversalTime()
    return $d.AddDays($n).ToString("yyyy-MM-dd")
}
$l1s = $demo.startDate; $l1e = AddDays $demo.startDate 3
$l2s = AddDays $demo.startDate 4; $l2e = AddDays $demo.startDate 7
$l3s = AddDays $demo.startDate 8; $l3e = $demo.endDate
$legsOk = Req "PUT" "/api/trips/$trip/legs" @{ legs = @(
    @{ name = "伦敦"; countryCode = "GB"; currency = "GBP"; timezone = "Europe/London"; startDate = $l1s; endDate = $l1e },
    @{ name = "巴黎"; countryCode = "FR"; currency = "EUR"; timezone = "Europe/Paris"; startDate = $l2s; endDate = $l2e },
    @{ name = "苏黎世"; countryCode = "CH"; currency = "CHF"; timezone = "Europe/Zurich"; startDate = $l3s; endDate = $l3e }
) }
Log "legs PUT 合法分段" ($legsOk.code -eq 200 -and $legsOk.json.legs.Count -eq 3) "code=$($legsOk.code) count=$($legsOk.json.legs.Count)"

$legsBad = Req "PUT" "/api/trips/$trip/legs" @{ legs = @(
    @{ name = "A"; countryCode = "GB"; currency = "GBP"; timezone = "Europe/London"; startDate = $l1s; endDate = $l2e },
    @{ name = "B"; countryCode = "FR"; currency = "EUR"; timezone = "Europe/Paris"; startDate = $l2s; endDate = $l3e }
) }
Log "legs PUT 重叠被拒 422" ($legsBad.code -eq 422) "status=$($legsBad.code)"

# ---------- 7. AI 分析（无 AI key → 规则引擎） ----------
$ins = Req "POST" "/api/insights" @{ tripId = $trip }
Log "insights 规则引擎" ($ins.code -eq 200 -and $ins.json.insight.headline.Length -gt 0) "headline=$($ins.json.insight.headline)"

# ---------- 8. 助手无 AI key → 501 ----------
$ast = Req "POST" "/api/assistant" @{ tripId = $trip; message = "还剩多少钱" }
Log "assistant 未配 AI 返回 501" ($ast.code -eq 501) "status=$($ast.code)"

# ---------- 9. fx 与跨域拦截 ----------
$fx = Req "GET" "/api/fx?base=CNY&currencies=GBP" $null
Log "fx GET（演示模式免登录）" ($fx.code -eq 200 -and $fx.json.quotes.GBP.rate -gt 0) "GBP=$($fx.json.quotes.GBP.rate)"

$evil = Req "POST" "/api/expenses" @{ tripId = $trip; expenses = @(@{ amount = 1; currency = "CNY" }) } @{ Origin = "http://evil.example" }
Log "跨站 Origin 被拒 403" ($evil.code -eq 403) "status=$($evil.code)"

# ---------- 10. 行程增删 ----------
$newTrip = Req "POST" "/api/trips" @{ name = "冒烟测试行程"; startDate = "2026-10-01"; endDate = "2026-10-07"; baseCurrency = "CNY"; timezone = "Asia/Shanghai"; budgets = @(@{ currency = "JPY"; amount = 100000; label = "日元" }) }
$ntid = $newTrip.json.trip.id
Log "trips POST" ($newTrip.code -eq 200 -and $null -ne $ntid) "id=$ntid"
$del = Req "DELETE" "/api/trips/$ntid" $null
$gone = Req "GET" "/api/trips" $null
$stillThere = @($gone.json.trips | Where-Object { $_.id -eq $ntid }).Count
Log "trips DELETE" ($del.code -eq 200 -and $stillThere -eq 0) "deleted=$($del.code -eq 200)"

# ---------- 清理 ----------
$delE = Req "DELETE" "/api/expenses/$eid" $null
Log "清理冒烟消费" ($delE.code -eq 200) "status=$($delE.code)"
foreach ($f in $script:tempFiles) { Remove-Item $f -ErrorAction SilentlyContinue }

$failed = @($script:results | Where-Object { -not $_.Ok }).Count
Write-Host "-----"
Write-Host "SMOKE RESULT: $($script:results.Count) checks, $failed failed"
