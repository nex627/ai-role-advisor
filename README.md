# 角色顾问（Role Advisor）

一个**纯静态、可自托管**的 AI 角色对话工作台。把「顾问页」从后端 API 里抽出来，改成浏览器直连大模型——

- **密钥只在你本地**：API 密钥、自定义角色、自定义知识库全部存浏览器（`localStorage` / `IndexedDB`），不上传任何服务器，也不进这个仓库。
- **默认内容在仓库里**：默认角色在 `presets/advisors.json`，默认知识库在 `kb/`（也可改成指向任意公开 GitHub 网址，见 §4），任何人 fork 都能拿到，也能自己增改后发 PR。
- **随便配**：可新增 / 编辑任意角色提示词、挂接任意知识库（仓库里的或自己贴的）。
- **零后端、零构建**：丢到 GitHub Pages / 任意静态托管即可，不需要服务器。

## 1. 本地预览

> 必须用本地服务器打开（不能直接双击 `index.html`，否则浏览器会因 `file://` 的 CORS 限制读不到预设文件）。

```bash
cd ai-role-advisor
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

打开后点右上角 ⚙，在「API 配置」里填：

| 字段 | 说明 | 示例 |
|---|---|---|
| 接口地址 | OpenAI 兼容的 Base URL，需允许浏览器跨域 | `https://api.deepseek.com/v1` |
| API 密钥 | **你的**密钥，只存本机 | `sk-...` |
| 模型名称 | 该接口下的模型 | `deepseek-chat` |

填完保存，回到对话即可。

## 2. 部署到 GitHub Pages

```bash
git init
git add -A
git commit -m "feat: 角色顾问静态站"
git branch -M main
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

然后在仓库 **Settings → Pages → Source** 选 `main` 分支根目录，等一两分钟即可通过 `https://<用户名>.github.io/<仓库名>/` 访问。

> 项目根目录已放 `.nojekyll`，避免 GitHub 的 Jekyll 处理把 `_` 开头的目录吞掉（本项目未用下划线目录，留着更稳妥）。

## 3. 怎么加自己的东西（都不进仓库）

- **加角色**：⚙ → ② 角色管理 → 新增角色。填名称、头像字、主题色、系统提示词，并勾选要挂接的知识库。
- **加知识库**：⚙ → ③ 知识库管理。三种方式任选：① 粘贴正文；② 上传 `.md`/`.txt`；③ **粘贴一个可跨域网址**（如 `raw.githubusercontent.com/.../xxx.md`），点「添加资料到本地」会自动抓取正文存到本地。
- 这些只存在你当前浏览器。**换设备 / 清缓存会丢**，重要资料建议同时自己备份一份。

## 4. 怎么改默认内容（进仓库，所有人共享）

- 编辑 `presets/advisors.json`：增删默认角色（字段见文件内注释）。
- 在 `kb/` 放新的 `.md`，并在 `kb/manifest.json` 的 `kbs` 数组里登记 `{id,title,file}`。
- 提交后部署即生效，fork 你的人也能拿到。

### 默认知识库也可以直接引用 GitHub 网址（不把文件放进本仓库）

不想把知识库文件提交到这个仓库？把 `kb/manifest.json` 里某条的 `file` 换成 `url` 即可，例如：

```json
{
  "kbs": [
    { "id": "huawei-basic-law", "title": "华为基本法（精要）",
      "url": "https://raw.githubusercontent.com/<用户名>/<仓库>/<分支>/kb/huawei-basic-law.md" }
  ]
}
```

- 运行时浏览器会直接 `fetch` 这个网址（GitHub raw 链接自带 `access-control-allow-origin: *`，可跨域抓取）。
- 这样本仓库就不含知识库正文，仓库保持轻量；代价是依赖那个外部仓库不被删、路径/分支不变。
- 只要填了 `url` 就优先用网址，没填 `url` 才回退到仓库本地 `file`。两者可混用。
- 想彻底不提交知识库文件，把 `kb/*.md` 删掉、全部改成 `url` 即可。

## 5. 知识库检索是怎么做的

完全在浏览器本地，不需要后端、不需要 embedding 接口：

1. 把每个知识库切成约 480 字的 chunk；
2. 对每次提问做中文二元 + 英文词分词；
3. 对每个 chunk 打分（词频加权、按长度归一化），取相关性最高的若干段；
4. 拼进系统提示词的「参考资料」段，随对话发给模型。

小文档会整体注入；大文档只取最相关片段，避免撑爆上下文。

> 想上质量更好的向量检索？可后续接入「调用 embedding 接口 + 本地余弦相似度」，作为可选项，不影响默认逻辑。

## 6. 安全与边界

- 这是**自托管工具**：密钥从你的浏览器直接发往你填写的模型厂商，站点本身不经手。请使用带额度限制的密钥，别把密钥填进别人搭的站。
- 模型可能出错，关键决策要靠人。角色提示词决定模型「怎么想」，不保证事实准确。
- 项目本身没有任何密钥、没有任何用户数据，可以放心公开。

## 目录结构

```
ai-role-advisor/
├─ index.html                 # 应用外壳
├─ assets/
│  ├─ css/style.css
│  └─ js/
│     ├─ config.js            # 本地存储（密钥/角色/对话）
│     ├─ llm.js               # 直连大模型（OpenAI 兼容，SSE 流式）
│     ├─ kb.js                # 知识库：默认 fetch + 本地检索
│     └─ app.js               # 主逻辑 / UI
├─ presets/advisors.json      # 默认角色（进仓库）
├─ kb/                        # 默认知识库（进仓库）
│  ├─ manifest.json
│  ├─ huawei-basic-law.md
│  ├─ blue-army.md
│  └─ role-prompt-guide.md
└─ .nojekyll
```
