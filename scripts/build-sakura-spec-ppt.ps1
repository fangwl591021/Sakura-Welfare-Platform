$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "docs"
$outFile = Join-Path $outDir "櫻花福委會福利資訊整合平台_會議簡報_2026-05-12.pptx"
$work = Join-Path $env:TEMP ("sakura-spec-ppt-" + [guid]::NewGuid().ToString("N"))

function X([string]$text) {
  return [System.Security.SecurityElement]::Escape($text)
}

function EnsureDir([string]$path) {
  if (!(Test-Path $path)) { New-Item -ItemType Directory -Path $path | Out-Null }
}

function WriteUtf8([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  EnsureDir $dir
  [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
}

$script:shapeId = 1
function NextId() {
  $script:shapeId += 1
  return $script:shapeId
}

function TextBox([int]$x, [int]$y, [int]$w, [int]$h, [string[]]$lines, [int]$font = 2000, [string]$color = "071226", [bool]$bold = $false, [string]$name = "Text") {
  $id = NextId
  $b = if ($bold) { ' b="1"' } else { "" }
  $paragraphs = foreach ($line in $lines) {
    "<a:p><a:r><a:rPr lang=""zh-TW"" sz=""$font""$b><a:solidFill><a:srgbClr val=""$color""/></a:solidFill><a:latin typeface=""Microsoft JhengHei""/><a:ea typeface=""Microsoft JhengHei""/></a:rPr><a:t>$(X $line)</a:t></a:r><a:endParaRPr lang=""zh-TW"" sz=""$font""/></a:p>"
  }
  @"
<p:sp>
  <p:nvSpPr><p:cNvPr id="$id" name="$(X $name)"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="$x" y="$y"/><a:ext cx="$w" cy="$h"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr>
  <p:txBody><a:bodyPr wrap="square" anchor="t"/><a:lstStyle/>$($paragraphs -join "")</p:txBody>
</p:sp>
"@
}

function Rect([int]$x, [int]$y, [int]$w, [int]$h, [string]$fill, [string]$line = "none", [int]$radius = 0) {
  $id = NextId
  $ln = if ($line -eq "none") { "<a:ln><a:noFill/></a:ln>" } else { "<a:ln w=""12700""><a:solidFill><a:srgbClr val=""$line""/></a:solidFill></a:ln>" }
  $geom = if ($radius -gt 0) { "roundRect" } else { "rect" }
  @"
<p:sp>
  <p:nvSpPr><p:cNvPr id="$id" name="Shape $id"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="$x" y="$y"/><a:ext cx="$w" cy="$h"/></a:xfrm><a:prstGeom prst="$geom"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="$fill"/></a:solidFill>$ln</p:spPr>
</p:sp>
"@
}

function SlideXml([string]$title, [string]$subtitle, [string[]]$bullets, [string]$section = "", [string]$accent = "E91646") {
  $script:shapeId = 1
  $shapes = @()
  $shapes += Rect 0 0 12192000 650000 $accent
  $shapes += TextBox 740000 160000 7600000 330000 @("櫻花福委會福利資訊整合平台") 1800 "FFFFFF" $true "Header"
  $shapes += TextBox 740000 950000 9200000 520000 @($title) 3100 "071226" $true "Title"
  if ($subtitle) { $shapes += TextBox 760000 1480000 9300000 360000 @($subtitle) 1500 "52627A" $false "Subtitle" }
  if ($section) { $shapes += TextBox 9900000 1040000 1600000 300000 @($section) 1300 $accent $true "Section" }
  $y = 2050000
  foreach ($b in $bullets) {
    if ($b -match "^\[(.+?)\](.*)$") {
      $label = $matches[1]
      $body = $matches[2].Trim()
      $shapes += Rect 780000 ($y - 60000) 260000 260000 "FFF0F3" "F6C7D2" 1
      $shapes += TextBox 840000 ($y - 25000) 160000 190000 @($label) 1150 $accent $true "No"
      $shapes += TextBox 1140000 ($y - 40000) 9200000 320000 @($body) 1700 "10213D" $false "Bullet"
      $y += 520000
    } else {
      $shapes += TextBox 860000 $y 9700000 320000 @("• " + $b) 1700 "10213D" $false "Bullet"
      $y += 430000
    }
  }
  $shapes += Rect 740000 6380000 10700000 45000 "E91646"
  @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    $($shapes -join "`n")
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"@
}

$slides = @(
  @{
    Title="明日規格討論重點"
    Subtitle="以福委會委員視角：讓員工找得到、用得到、被照顧；讓廠商能上架；讓福委會能監看與稽核。"
    Section="00"
    Bullets=@(
      "[1]平台定位：LINE OA 福利資訊整合平台，不只是公告頁。",
      "[2]母站負責員工驗證與點數，子站負責福委會營運流程。",
      "[3]廠商註冊、優惠上架、AI OCR、QR 折抵都需審核與紀錄。",
      "[4]多語 AI、聊天室監控、分眾推播是提升使用率與管理效率的核心。"
    )
  },
  @{
    Title="整體系統架構"
    Subtitle="LINE 事件先進 Cloudflare Worker，再分流到母站與子站，保留既有流程，同時建立福委會營運資料。"
    Section="01"
    Bullets=@(
      "LINE OA Webhook：/line-webhook。",
      "母站 webhook：https://aiwe.cc/index.php/line_login/9111/。",
      "子站資料：D1 儲存聊天室、廠商、優惠、CRM、推播與折抵紀錄。",
      "R2 儲存廠商文件、菜單、圖片與知識庫檔案。",
      "OpenAI API 用於 OCR、輿情分類、多語翻譯與知識庫問答。"
    )
  },
  @{
    Title="母站與子站分工"
    Subtitle="原則：會員與點數權威留在母站；福委會營運與廠商內容放在子站。"
    Section="02"
    Bullets=@(
      "[母站]員工名冊、LINE_user_id 對應、員工驗證、點數新增與查詢。",
      "[子站]廠商註冊審核、優惠上架、LINE 監控、CRM、地圖、Flex、Rich Menu。",
      "[串接]子站透過 API 呼叫母站點數與驗證結果，不自行成為點數權威。",
      "[安全]API Key、LINE Token、OpenAI Key 都放在 Worker secrets，不外露前端。"
    )
  },
  @{
    Title="會員、員工與 CRM"
    Subtitle="所有加入 LINE OA 的好友都進 CRM；員工以工號 + 生日四碼完成綁定。"
    Section="03"
    Bullets=@(
      "員工驗證：員工工號 + 生日四碼 MMDD。",
      "CRM 身份：員工、訪客、廠商、委員、未知。",
      "CRM 欄位：LINE ID、姓名、頭像、電話、Email、標籤、推薦人、最近互動。",
      "推薦好友：連結需帶 UID，接受邀約者登記在推薦人名下。"
    )
  },
  @{
    Title="廠商註冊與審核"
    Subtitle="申請表需完整保存公司登記、聯絡資料、證照、保險、合約與優惠政策。"
    Section="04"
    Bullets=@(
      "廠商申請頁：/vendor-apply。",
      "文件上傳必須用檔案上傳，不要求廠商填 URL。",
      "後台採 CRM 表格：一行一家，新申請往上排，點入後查看完整申請表。",
      "審核狀態：待審、核准、退回、停權；合作狀態：新合作、啟用、續約中、到期。"
    )
  },
  @{
    Title="商品優惠上架與 AI OCR"
    Subtitle="廠商可上傳菜單、DM、商品照，由 AI 擷取成草稿，人工確認後送審。"
    Section="05"
    Bullets=@(
      "欄位：商品名稱、分類、原價、員工價、訪客價、使用限制、可用地點、QR 核銷。",
      "價格規則：訪客價不得低於員工價。",
      "AI OCR 只產生草稿，不可直接公開。",
      "福委會審核優惠揭露、價格規則與員工權益，不干涉日常經營。"
    )
  },
  @{
    Title="QR 折抵與點數"
    Subtitle="掃碼時依身份決定折抵，點數從母站讀寫，子站保留業務紀錄。"
    Section="06"
    Bullets=@(
      "身份：員工、訪客、廠商操作員、管理員。",
      "折抵紀錄：原價、員工價、訪客價、實付、折抵、店家、操作員、時間。",
      "點數 API：新增點數 insert-user-point，查詢 query-user-point-list。",
      "活動：每日打卡取點、到店打卡、推薦好友、活動參與。"
    )
  },
  @{
    Title="LINE OA 專區"
    Subtitle="管理 LINE 入口、聊天室、關鍵字、Rich Menu、Flex Message 與分眾推播。"
    Section="07"
    Bullets=@(
      "LINE OA 總覽：Webhook、D1、Token、OpenAI、最新事件、待處理訊息。",
      "聊天室監控：AI 建議只供管理員參考，不自動回覆。",
      "關鍵字表：分享給好友、每日打卡取點、到店打卡、Flex 回覆、客製流程。",
      "Rich Menu：上傳底圖、劃區、部署 LINE；Flex：自由版、網址擷取器、分享與推播。"
    )
  },
  @{
    Title="全省地圖與醫療院所"
    Subtitle="特約店分布不只廠區，需支援全台、離島、縣市與分類索引。"
    Section="08"
    Bullets=@(
      "分類：食、衣、住、行、育、樂、醫療、其他。",
      "區域：北部、中部、南部、東部、離島。",
      "特約醫療院所：保留在縣市分類，也要有獨立篩選入口。",
      "本期不做 LBS 定位，以靜態分類、地圖連結與 Flex 縣市入口呈現。"
    )
  },
  @{
    Title="分眾推播與 Flex 內容"
    Subtitle="依 CRM 標籤、身份與互動狀態篩選受眾，發送官方格式或系統客製 Flex。"
    Section="09"
    Bullets=@(
      "篩選：身份、綁定狀態、標籤、地區、活動、推薦來源、最近互動。",
      "內容：官方文字、官方圖片、Flex 模板、貼上 Flex JSON。",
      "LIFF 分享好友必須使用 liff.shareTargetPicker，不手動拼 URL。",
      "推播需保留受眾條件、成功失敗數、操作者與時間。"
    )
  },
  @{
    Title="AI 與多語服務"
    Subtitle="AI 協助 OCR、翻譯、客服監控、知識庫問答與風險提醒。"
    Section="10"
    Bullets=@(
      "支援語言：繁體中文、印尼文、泰文。",
      "知識庫：文字、網址、檔案；檔案需上傳保存。",
      "AI 回答需依知識庫與福利規則，避免自行亂答。",
      "AI 輿情分類：抱怨、稱讚、建議、廠商支援、高風險、待追蹤。"
    )
  },
  @{
    Title="第一階段 P0 驗收"
    Subtitle="明天可先確認 P0 項目作為第一階段交付標準。"
    Section="11"
    Bullets=@(
      "Webhook 驗證、母站轉發、子站 D1 寫入。",
      "員工驗證、CRM 建立、廠商申請、文件上傳、審核流程。",
      "商品優惠審核、價格規則、QR 折抵、母站點數 API。",
      "Flex 分享、Rich Menu 部署、分眾推播、權限與敏感 Key 不外露。"
    )
  },
  @{
    Title="明日會議待確認"
    Subtitle="建議逐條決策，避免需求發散。"
    Section="12"
    Bullets=@(
      "員工名冊來源、工號格式、生日四碼規則。",
      "廠商必填文件、審核 SLA、醫療院所是否獨立審核。",
      "每日打卡、到店打卡、推薦好友的給點規則。",
      "誰可以正式分眾推播、AI 是否只能建議、哪些資料屬敏感資訊。"
    )
  }
)

EnsureDir $work
EnsureDir (Join-Path $work "_rels")
EnsureDir (Join-Path $work "ppt")
EnsureDir (Join-Path $work "ppt\_rels")
EnsureDir (Join-Path $work "ppt\slides")
EnsureDir (Join-Path $work "ppt\slides\_rels")
EnsureDir (Join-Path $work "ppt\slideMasters")
EnsureDir (Join-Path $work "ppt\slideMasters\_rels")
EnsureDir (Join-Path $work "ppt\slideLayouts")
EnsureDir (Join-Path $work "ppt\slideLayouts\_rels")
EnsureDir (Join-Path $work "ppt\theme")
EnsureDir (Join-Path $work "docProps")

$slideOverrides = @()
$slideIds = @()
$slideRels = @()
$idx = 1
foreach ($s in $slides) {
  WriteUtf8 (Join-Path $work "ppt\slides\slide$idx.xml") (SlideXml $s.Title $s.Subtitle $s.Bullets $s.Section)
  WriteUtf8 (Join-Path $work "ppt\slides\_rels\slide$idx.xml.rels") '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  $slideOverrides += "<Override PartName=""/ppt/slides/slide$idx.xml"" ContentType=""application/vnd.openxmlformats-officedocument.presentationml.slide+xml""/>"
  $sid = 255 + $idx
  $rid = $idx + 1
  $slideIds += "<p:sldId id=""$sid"" r:id=""rId$rid""/>"
  $slideRels += "<Relationship Id=""rId$rid"" Type=""http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"" Target=""slides/slide$idx.xml""/>"
  $idx += 1
}

WriteUtf8 (Join-Path $work "[Content_Types].xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  $($slideOverrides -join "`n  ")
</Types>
"@

WriteUtf8 (Join-Path $work "_rels\.rels") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@

WriteUtf8 (Join-Path $work "docProps\core.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>櫻花福委會福利資訊整合平台會議簡報</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-05-12T00:00:00Z</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-12T00:00:00Z</dcterms:modified>
</cp:coreProperties>
"@

WriteUtf8 (Join-Path $work "docProps\app.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft PowerPoint</Application>
  <PresentationFormat>寬螢幕</PresentationFormat>
  <Slides>$($slides.Count)</Slides>
</Properties>
"@

WriteUtf8 (Join-Path $work "ppt\presentation.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>$($slideIds -join "")</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-TW"/></a:defPPr></p:defaultTextStyle>
</p:presentation>
"@

WriteUtf8 (Join-Path $work "ppt\_rels\presentation.xml.rels") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  $($slideRels -join "`n  ")
</Relationships>
"@

WriteUtf8 (Join-Path $work "ppt\slideMasters\slideMaster1.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>
"@

WriteUtf8 (Join-Path $work "ppt\slideMasters\_rels\slideMaster1.xml.rels") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
"@

WriteUtf8 (Join-Path $work "ppt\slideLayouts\slideLayout1.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
"@

WriteUtf8 (Join-Path $work "ppt\slideLayouts\_rels\slideLayout1.xml.rels") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
"@

WriteUtf8 (Join-Path $work "ppt\theme\theme1.xml") @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Sakura">
  <a:themeElements>
    <a:clrScheme name="Sakura"><a:dk1><a:srgbClr val="071226"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="10213D"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="E91646"/></a:accent1><a:accent2><a:srgbClr val="2F80ED"/></a:accent2><a:accent3><a:srgbClr val="06C755"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0F766E"/></a:accent6><a:hlink><a:srgbClr val="2F80ED"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Sakura"><a:majorFont><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft JhengHei"/><a:ea typeface="Microsoft JhengHei"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Sakura"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>
"@

if (Test-Path $outFile) { Remove-Item -LiteralPath $outFile -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($outFile, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $work -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($work.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zip.Dispose()
}
Remove-Item -LiteralPath $work -Recurse -Force
Write-Output $outFile
