# 單字練習工具 (Word Practice Tool)

一個通用的單字練習網站：**聽發音 → 拼出單字 → 選正確定義**，寫錯的會自動再練。
支援**多個單字表與多種語言**——內建英文 AWL（570 字），並可輕鬆加入其他單字表，甚至日文。

第一個內建單字表來自 [RMIT Academic Word List](https://learninglab.rmit.edu.au/writing-fundamentals/academic-word-list-tool/)。

## 練習流程

1. **選單字表** — 從下拉選單挑選要練習的單字表（例如 AWL、日文…）
2. **聽發音** — 英文用 Hugging Face 開源 TTS 模型（SpeechT5）；其他語言用瀏覽器語音
3. **拼寫單字** — 聽完後輸入你聽到的單字
4. **選定義** — 拼完後，從選項中選出正確的定義（主要釋義 + 補充說明）
5. **錯題重練** — 拼錯或選錯的單字會被記錄，整輪結束後自動再練一次，直到全部答對

## 功能

- **多單字表**：把資料夾丟進 `data/datasets/` 就會自動出現，無需改程式
- **多語言**：每個單字表可設定語言；英文用後端 SpeechT5，其他語言（如日文 `ja-JP`）用瀏覽器語音
- 可選擇練習特定分組（如 AWL 的 Sublist）或全部
- 進度與錯題記錄存在瀏覽器 `localStorage`，**依單字表分開記錄**，關掉再開仍保留
- TTS 語音在後端快取，第二次聽同一個字不需重新合成
- 後端 TTS 不可用時，前端自動退回瀏覽器內建語音 (Web Speech API)

## 專案結構

```
word-practice-tool/
├── backend/
│   ├── app.py            # FastAPI：掃描單字表、單字 API、依語言合成 TTS
│   └── tts.py            # Hugging Face SpeechT5 封裝（依語言切換引擎）
├── data/
│   ├── awl_headwords.json    # AWL 權威字表（建資料用）
│   ├── build_dataset.py      # 由字表 + 定義產生 awl 單字表
│   └── datasets/             # ★ 所有單字表都放這裡，一個資料夾一個單字表
│       ├── awl/
│       │   ├── manifest.json # 單字表設定（id / name / lang / groupLabel）
│       │   └── words.json    # 單字（word / group / primary / secondary）
│       └── sample-ja/        # 日文範例（示範多語言；可當新增單字表的範本）
│           ├── manifest.json
│           └── words.json
├── frontend/
│   ├── index.html / style.css / app.js
├── cache/
│   ├── *.wav             # TTS 產生的單字語音快取（自動建立）
│   └── model/            # Hugging Face 模型下載位置（可手動放入模型）
├── pyproject.toml        # uv 專案設定與相依套件
├── uv.lock               # uv 鎖定的相依版本
├── .python-version       # 指定 Python 3.12
└── README.md
```

## 安裝與執行（使用 [uv](https://docs.astral.sh/uv/)）

本專案以 **uv** 管理 Python 環境與套件。請先安裝 uv：

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

接著在專案根目錄：

```bash
# 1. 建立虛擬環境並安裝所有相依套件
#    （第一次會下載 PyTorch 與相關套件，約數百 MB）
uv sync

# 2. 啟動後端（同時提供前端靜態檔）
uv run python backend/app.py
```

啟動後開瀏覽器到 **http://localhost:8000**

> uv 會自動依 `.python-version` 取得 Python 3.12，並依 `uv.lock` 安裝鎖定版本，不需要先手動建立 venv。
>
> 第一次呼叫發音時，後端會再從 Hugging Face 下載 SpeechT5 模型，請耐心等待。
> 下載完成後模型會快取在本機，之後啟動很快。

### 常用 uv 指令

```bash
uv sync                       # 依 lock 安裝/同步環境
uv add <package>              # 新增相依套件（會更新 pyproject.toml 與 uv.lock）
uv remove <package>           # 移除相依套件
uv lock --upgrade             # 升級並重新鎖定所有套件
uv export -o requirements.txt # 需要 pip 格式時，匯出 requirements.txt
```

> 想用瀏覽器內建語音快速試玩、暫時不裝 PyTorch？
> 只安裝 Web 套件即可：`uv pip install fastapi "uvicorn[standard]"`，再 `uv run python backend/app.py`。
> 後端 TTS 不可用時，前端會自動退回瀏覽器內建語音 (Web Speech API)。

## 新增單字表（多語言）

後端會自動掃描 `data/datasets/` 下的每個資料夾，所以**新增單字表只要加一個資料夾**，
不需要改任何程式。每個資料夾要有兩個檔案：

`manifest.json` — 單字表的設定：

```json
{
  "id": "jlpt-n5",
  "name": "日文 JLPT N5",
  "lang": "ja-JP",
  "groupLabel": "等級",
  "description": "說明文字"
}
```

| 欄位         | 說明                                                              |
| ------------ | ----------------------------------------------------------------- |
| `id`         | 唯一代號（也用於網址與錯題記錄的儲存鍵）                          |
| `name`       | 下拉選單顯示的名稱                                                 |
| `lang`       | 語言碼（如 `en-US`、`ja-JP`、`zh-TW`），決定發音引擎與瀏覽器語音  |
| `groupLabel` | 分組的標籤（如 `Sublist`、`等級`）；若單字沒有分組可省略           |
| `description`| 說明（選填）                                                      |

`words.json` — 單字陣列，每個單字用通用 schema：

```json
[
  { "word": "ひと", "group": "N5", "primary": "人", "secondary": "漢字：人 / hito (n.)" }
]
```

| 欄位        | 說明                                                       |
| ----------- | ---------------------------------------------------------- |
| `word`      | 拼寫目標，也就是要「聽完輸入」的字（日文建議用平假名）      |
| `group`     | 分組名稱（如 `Sublist 1`、`N5`）；沒有分組可省略           |
| `primary`   | 主要釋義，會顯示在選項上方並作為正確答案（例如中文）        |
| `secondary` | 補充說明，顯示在下方（例如詞性 + 英文解釋、漢字、羅馬拼音） |

加好資料夾後**重新啟動後端**即可，新單字表會自動出現在下拉選單。

> 內建的 `data/datasets/sample-ja/` 就是一個可直接複製修改的日文範例。

### 各語言的發音

- **英文 (`en-`)**：使用後端 Hugging Face SpeechT5 模型，語音較自然並會快取。
- **其他語言（日文等）**：目前由**瀏覽器內建語音**負責（需作業系統有該語言的語音；
  Windows 可在「設定 → 時間與語言 → 語音」加裝日文語音）。
- 想為日文等語言加上**後端模型**？在 `backend/tts.py` 的語言分派處新增一個引擎即可
  （`synthesize_wav` 依 `lang` 切換，目前只實作英文，其餘會自動退回瀏覽器語音）。

## TTS 模型

預設使用（全部開源，可從 Hugging Face 下載）：

- `microsoft/speecht5_tts`（文字轉語音）
- `microsoft/speecht5_hifigan`（vocoder）
- `Matthijs/cmu-arctic-xvectors`（語者嵌入）

可在 `backend/tts.py` 更換為其他模型。

### 模型下載位置

所有模型與語者嵌入資料都會下載到專案內的：

```
cache/model/
├── hub/        # 透過 Hub 下載的模型快取
└── datasets/   # 語者嵌入 (cmu-arctic-xvectors) 快取
```

程式已將 `HF_HOME` / `HF_HUB_CACHE` / `HF_DATASETS_CACHE` 指到這個資料夾，
所以不會污染你系統預設的 `~/.cache/huggingface`。

### 手動放入模型（離線使用）

如果你已經有模型檔案（例如在無網路環境），可以手動把模型資料夾放到：

```
cache/model/speecht5_tts/        # 放 microsoft/speecht5_tts 的檔案
cache/model/speecht5_hifigan/    # 放 microsoft/speecht5_hifigan 的檔案
```

只要該資料夾存在且非空，程式就會**直接從本地載入、不再連線下載**。
資料夾內需包含模型本身的檔案，例如 `config.json`、`model.safetensors`
（或 `pytorch_model.bin`）、以及 processor 相關檔案。

> 取得方式範例：
> `huggingface-cli download microsoft/speecht5_tts --local-dir cache/model/speecht5_tts`
>
> 對應的本地資料夾名稱定義在 `backend/tts.py` 的 `LOCAL_DIRS`，可自行調整。
