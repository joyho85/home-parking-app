# 何家停車場管理系統｜單一共用帳號版

這版是你要的簡化架構：

- 只有一個停車場
- 只有一組共用帳號密碼，例如 `admin`
- 登入後直接看到管理畫面
- 資料存在 Supabase 的單一 `app_state` 表
- 手機、電腦都會讀同一份資料

---

## 一、Supabase 設定

1. 打開你的 Supabase 專案
2. 進入 **SQL Editor**
3. 新增查詢
4. 把 `supabase_simple_state.sql` 全貼上執行

跑完後，你會有一張表：
- `app_state`

---

## 二、Netlify 部署

### 1. 上傳整個資料夾到 GitHub
建議把這個資料夾整包放進 GitHub repo。

### 2. 在 Netlify 匯入 GitHub 專案
因為這版有 Netlify Functions，請用 **Import from Git**，不要用單純拖拉檔案。

### 3. 在 Netlify 設定環境變數
到：
**Site configuration → Environment variables**

新增這 5 個：

- `APP_USERNAME`  
  例如：`admin`

- `APP_PASSWORD`  
  例如：你們家要共用的密碼

- `SESSION_SECRET`  
  請設一串很長的亂碼，至少 32 字元  
  例如可以自己產生：`hJ93kLx2pQ8mR4tY7vN1zC6bF0sW5aDe`

- `SUPABASE_URL`  
  例如：`https://xxxxxxxx.supabase.co`

- `SUPABASE_SERVICE_ROLE_KEY`  
  請到 Supabase 的 API Keys 頁面找 **secret key / service role key**
  這個只放在 Netlify 環境變數，不要寫進前端。

### 4. 重新部署
環境變數設好後，重新 deploy 一次。

---

## 三、怎麼登入

打開網站後，登入頁會要求：

- 帳號
- 密碼

輸入你在 Netlify 設定的：
- `APP_USERNAME`
- `APP_PASSWORD`

登入成功後，就能直接管理停車場。

---

## 四、這版的特性

### 優點
- 很簡單，符合你家只有一個停車場的情境
- 不用 email 註冊
- 不用一堆使用者權限表
- 手機跟電腦可以同步

### 要知道的事
- 這版是「單一共用帳號」
- 如果兩個人同時改同一份資料，後存的人會蓋掉前面的版本
- 對家庭小型使用通常沒問題

---

## 五、你最常會用到的兩個地方

### Supabase
只要跑一次 SQL 就好

### Netlify
之後如果要改共用帳號或密碼，只改環境變數就行

---

## 六、如果你要本機測試
這版因為有 Netlify Functions，直接雙擊 `index.html` 不能完整測登入流程。

你需要：
- 部署到 Netlify
或
- 用 Netlify CLI 在本機跑

如果你只想快一點，建議直接上 Netlify。
