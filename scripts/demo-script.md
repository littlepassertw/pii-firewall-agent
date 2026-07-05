# Demo / 影片腳本（5 分鐘）

錄影素材對照表。旁白為英文（AI 配音），畫面依段落切換。

## 段落規劃

| # | 時間 | 畫面 | 旁白重點 |
|---|---|---|---|
| 1 | 0:00–0:40 | 標題字卡 → 問題字卡 | HR documents = most sensitive data; pasting into cloud LLM = compliance breach; ban or leak dilemma |
| 2 | 0:40–1:10 | 架構圖字卡（mermaid 圖轉 PNG） | de-identify → cloud reasoning → re-identify; the model never needs real data |
| 3 | 1:10–3:10 | adk web 實錄 | 完整 demo 流程（下方） |
| 4 | 3:10–4:00 | 終端機分割畫面 | `.sessions/*.json`（真實資料只在本機）+ stderr audit log（雲端看到的全部） + `npm test` 綠燈 |
| 5 | 4:00–4:30 | 安全性字卡 | whitelist exit, least-privilege tool filters, the claim is an executable test |
| 6 | 4:30–5:00 | The Build 字卡 + Antigravity 截圖 | built with Claude Code + Antigravity; MCP SDK + ADK + local ONNX NER |

## adk web 實錄流程（段落 3）

事前準備：
```bash
cd agent && ./run_web.sh        # http://localhost:8000
rm -f ../mcp-server/.sessions/*.json ../output/*
```

1. 輸入：`請處理 ../samples/resume_01.txt，幫我寫一封推薦這位候選人給用人主管的內部 Email（繁體中文）。`
   - 停留在 trace 面板：coordinator → `ingest_and_redact`（畫面放大 redacted_text，看得到 A君/[ID-01]）
   - transfer 到 hr_task_writer → 草稿產出
   - transfer 到 compliance_auditor → `scan_text_for_pii` → APPROVED
2. 輸入：`請還原並輸出成 email_final.txt`
   - 回應只有檔案路徑 → 切終端機 `cat output/email_final.txt` 顯示真實姓名回來了
3. 加分畫面（security）：貼一段含假身分證的文字到對話 → coordinator 拒絕，要求改提供檔案路徑

## 段落 4 終端機指令

```bash
cat mcp-server/.sessions/*.json | head -30   # 真實資料唯一存放處
cd mcp-server && npm test                     # 13/13 pass（含 no-leak 整合測試）
```
