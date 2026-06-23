# AWL 練習工具 (Academic Word List Practice Tool)

根據 [RMIT Academic Word List](https://learninglab.rmit.edu.au/writing-fundamentals/academic-word-list-tool/) 的 570 個學術單字設計的練習網站。

## 練習流程

1. **聽發音** — 用 Hugging Face 開源 TTS 模型（SpeechT5）合成單字語音
2. **拼寫單字** — 聽完後輸入你聽到的單字
3. **選定義** — 拼對後，從選項中選出正確的「英文釋義 + 繁體中文」定義
4. **錯題重練** — 拼錯或選錯的單字會被記錄，整輪結束後自動再練一次，直到全部答對

## 功能

- 完整 570 個 AWL 單字，分 10 個 sublist
- 可選擇練習特定 sublist 或全部
- 進度與錯題記錄存在瀏覽器 `localStorage`，關掉再開仍保留
- TTS 語音在後端快取，第二次聽同一個字不需重新合成
- 後端 TTS 不可用時，前端自動退回瀏覽器內建語音 (Web Speech API)

## 專案結構

```
AWL-practice-tool/
├── backend/
│   ├── app.py            # FastAPI：單字 API + TTS 合成
│   └── tts.py            # Hugging Face SpeechT5 封裝
├── data/
│   └── awl_words.json    # 570 個 AWL 單字（word / sublist / pos / en / zh）
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
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
