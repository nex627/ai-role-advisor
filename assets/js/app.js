/* 主逻辑：合并默认/自定义角色，渲染对话、设置、角色管理与知识库管理 */
(function () {
    'use strict';

    var state = {
        settings: null,
        threads: {},
        defaultAdvisors: [],
        customAdvisors: [],
        advisors: [],
        allKbs: [],
        advisor: 'basiclaw',
        running: {},
        ctrl: {}
    };
    var pendingAdvisor = null; // 引导页里选中的起始角色
    var welcomeCreatePending = false; // 从模板创建后是否自动进入工作台
    var templateSrc = null; // 模板来源（用于复制 samples/hint）

    var el = {};
    var STORE_KEY = RA.Config.KEYS.threads;

    /* ===================== 工具 ===================== */
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function md(src) {
        var t = esc(src);
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/^#{1,4}\s*(.+)$/gm, '<span class="md-h">$1</span>');
        t = t.replace(/^\s*[-*]\s+(.+)$/gm, '<span class="md-li">$1</span>');
        t = t.replace(/^\s*\d+[.、]\s+(.+)$/gm, '<span class="md-li">$1</span>');
        return t.split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
    }
    function getAdvisor(id) {
        return state.advisors.filter(function (a) { return a.id === id; })[0];
    }
    function save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ advisor: state.advisor, threads: state.threads }));
        } catch (e) {}
        RA.Config.saveThreads(state.threads);
    }

    /* ===================== 渲染：对话 ===================== */
    function render() {
        var tid = state.advisor;
        var list = state.threads[tid] || (state.threads[tid] = []);
        if (list.length === 0) {
            var a = getAdvisor(tid);
            var who = a ? (a.name + (a.role ? ' · ' + a.role : '')) : '顾问';
            var hint = a && a.hint ? a.hint : '说清你的处境和目标，开始对话。';
            var samples = (a && a.samples) || [];
            var html = '<div class="empty"><h3>' + esc(who) + '</h3><div class="hint">' + esc(hint) + '</div>';
            if (samples.length) {
                html += '<div class="label">试试这样问：</div><div class="samples">';
                samples.forEach(function (s) { html += '<button class="sample" data-q="' + esc(s) + '">' + esc(s) + '</button>'; });
                html += '</div>';
            }
            html += '</div>';
            el.msgs.innerHTML = html; el.msgs.scrollTop = 0;
            return;
        }
        renderTurns(true);
    }

    function turnHTML(m, tid) {
        var a = getAdvisor(tid);
        var who = a ? (a.name + (a.role ? ' · ' + a.role : '')) : '顾问';
        if (m.role === 'user') {
            return '<div class="turn user"><div class="bubble"><div class="who">我</div>' +
                '<div class="txt">' + md(m.content) + '</div></div></div>';
        }
        var body;
        if (m.error) {
            body = '<div class="err">' + esc(m.error) + '<small>可能是密钥无效、接口不支持跨域，或服务繁忙。检查设置后重试。</small></div>';
        } else if (m.content) {
            body = md(m.content) + (m.pending ? '<span class="caret"></span>' : '');
        } else {
            body = '<div class="thinking">正在思考<span class="dots"><i></i><i></i><i></i></span></div>';
        }
        return '<div class="turn ai" data-advisor="' + tid + '">' +
            '<div class="bubble"><div class="who">' + esc(who) + '</div>' +
            '<div class="txt">' + body + '</div></div></div>';
    }

    function renderTurns(scrollToEnd) {
        var tid = state.advisor;
        var list = state.threads[tid] || [];
        var nearBottom = true;
        if (el.msgs.scrollHeight > el.msgs.clientHeight + 40) {
            nearBottom = (el.msgs.scrollHeight - el.msgs.scrollTop - el.msgs.clientHeight) < 140;
        }
        el.msgs.innerHTML = list.map(function (m) { return turnHTML(m, tid); }).join('');
        if (scrollToEnd || nearBottom) el.msgs.scrollTop = el.msgs.scrollHeight;
    }

    function updateControls() {
        var tid = state.advisor, busy = state.running[tid], a = getAdvisor(tid);
        el.send.style.display = busy ? 'none' : '';
        el.stop.style.display = busy ? '' : 'none';
        el.input.placeholder = busy ? '顾问正在回答…' : (a && a.placeholder ? a.placeholder : '说说你的问题或方案…');
    }

    function updateTabs() {
        el.tabs.innerHTML = '';
        var s = document.createElement('button');
        s.className = 'tab settings-tab';
        s.innerHTML = '<div class="mark" style="background:#475569"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></div>' +
            '<div class="meta"><div class="name">设置</div><div class="desc">密钥 · 角色 · 知识库</div></div>';
        s.addEventListener('click', openSettings);
        el.tabs.appendChild(s);
        state.advisors.forEach(function (a) {
            var isCustom = state.customAdvisors.filter(function (x) { return x.id === a.id; })[0];
            var btn = document.createElement('button');
            btn.className = 'tab' + (a.id === state.advisor ? ' active' : '') + (state.running[a.id] ? '' : '');
            btn.setAttribute('data-advisor', a.id);
            if (state.running[a.id]) btn.setAttribute('data-running', '1');
            btn.innerHTML =
                '<div class="meta"><div class="name">' + esc(a.name) + (a.role ? '<span class="role">' + esc(a.role) + '</span>' : '') + (isCustom ? '' : '<span class="builtin-tag">内置</span>') + '<span class="spin"></span></div>' +
                '<div class="desc">' + esc(a.desc || a.role || '') + '</div></div>';
            btn.addEventListener('click', function () { switchTo(a.id); });
            el.tabs.appendChild(btn);
        });
    }

    function updateKbLine() {
        var a = getAdvisor(state.advisor);
        var ids = (a && a.kbIds) || [];
        if (!ids.length) { el.kbLine.innerHTML = '未挂接资料'; return; }
        var names = ids.map(function (id) {
            var k = state.allKbs.filter(function (x) { return x.id === id; })[0];
            return k ? k.title : null;
        }).filter(Boolean);
        el.kbLine.innerHTML = '挂接资料：<b>' + names.join('、') + '</b>';
    }

    /* ===================== 切换角色 ===================== */
    function switchTo(tid) {
        if (!getAdvisor(tid) || tid === state.advisor) return;
        state.advisor = tid;
        updateTabs(); render(); updateControls(); updateKbLine(); save();
    }

    /* ===================== 发送 ===================== */
    function send(text) {
        text = (text || '').trim();
        var tid = state.advisor;
        if (!text || state.running[tid]) return;
        if (!state.settings.apiKey) { openSettings(); flashSetMsg('请先在「API 配置」里填写你的密钥', false); return; }

        var list = state.threads[tid] || (state.threads[tid] = []);
        var a = getAdvisor(tid);
        var history = list.filter(function (m) { return m.content && !m.error; })
            .map(function (m) { return { role: m.role, content: m.content }; });
        history.push({ role: 'user', content: text });

        list.push({ role: 'user', content: text });
        var placeholder = { role: 'assistant', content: '', pending: true };
        list.push(placeholder);

        el.input.value = ''; autoGrow();
        state.running[tid] = true; updateTabs(); renderTurns(true); updateControls(); save();

        var kbIds = (a && a.kbIds) || [];
        var kbList = kbIds.map(function (id) {
            var f = state.allKbs.filter(function (k) { return k.id === id; })[0];
            return f ? { id: f.id, source: f.source } : null;
        }).filter(Boolean);

        var finish = function (refText) {
            var system = a.system || '';
            if (refText) system = system + '\n\n# 参考资料（来自你挂接的知识库，仅供回答参考，若与问题无关可忽略）\n' + refText;
            var messages = [{ role: 'system', content: system }].concat(history);
            stream(messages, placeholder, tid);
        };
        if (kbList.length) {
            RA.KB.retrieve(text, kbList).then(finish).catch(function () { finish(''); });
        } else {
            finish('');
        }
    }

    function stream(messages, placeholder, tid) {
        var ctrl = new AbortController();
        state.ctrl[tid] = ctrl;
        RA.LLM.stream({
            baseURL: state.settings.baseURL,
            apiKey: state.settings.apiKey,
            model: state.settings.model,
            temperature: state.settings.temperature,
            messages: messages,
            signal: ctrl.signal,
            onDelta: function (d) { placeholder.content += d; placeholder.pending = false; },
            onFlush: function () { if (tid === state.advisor) renderTurns(false); },
            onDone: function () { finalize(placeholder, tid, null); },
            onAbort: function () { finalize(placeholder, tid, 'abort'); },
            onError: function (e) { finalize(placeholder, tid, e); }
        });
    }

    function finalize(placeholder, tid, err) {
        placeholder.pending = false;
        if (err === 'abort') {
            placeholder.content = placeholder.content ? placeholder.content + '\n\n（已停止）' : '（已停止）';
        } else if (err) {
            placeholder.error = '回答失败：' + (err && err.message ? err.message : err);
        }
        state.running[tid] = false; state.ctrl[tid] = null;
        updateTabs();
        if (tid === state.advisor) { renderTurns(true); updateControls(); }
        save();
    }

    /* ===================== 设置抽屉 ===================== */
    function openSettings() { el.drawer.classList.add('show'); el.overlay.classList.add('show'); el.drawer.setAttribute('aria-hidden', 'false'); fillSettings(); }
    function closeSettings() {
        el.drawer.classList.remove('show'); el.overlay.classList.remove('show'); el.drawer.setAttribute('aria-hidden', 'true');
        // 关闭设置后：已配密钥则保持引导页隐藏；未配则回到引导页
        if (state.settings && state.settings.apiKey) hideWelcome(); else showWelcome();
    }

    function fillSettings() {
        $('set-baseURL').value = state.settings.baseURL || '';
        $('set-apiKey').value = state.settings.apiKey || '';
        $('set-model').value = state.settings.model || '';
        $('set-temperature').value = state.settings.temperature;
        $('tempVal').textContent = state.settings.temperature;
    }
    function flashSetMsg(msg, ok) {
        var n = $('set-msg'); n.textContent = msg; n.className = 'save-msg ' + (ok ? 'ok' : 'err');
    }

    /* ===================== 角色管理 ===================== */
    function buildAdvisors() { state.advisors = state.defaultAdvisors.concat(state.customAdvisors); }
    function refreshAdvisors() {
        state.customAdvisors = RA.Config.getCustomAdvisors();
        buildAdvisors();
        if (!getAdvisor(state.advisor) && state.advisors.length) state.advisor = state.advisors[0].id;
        updateTabs(); render(); updateControls(); updateKbLine();
    }

    function renderAdvisorList() {
        var box = $('advisor-list'); box.innerHTML = '';
        state.advisors.forEach(function (a) {
            var isCustom = state.customAdvisors.filter(function (x) { return x.id === a.id; })[0];
            var item = document.createElement('div'); item.className = 'item';
            item.innerHTML =
                '<div class="info"><div class="t">' + esc(a.name) + '</div><div class="s">' + esc(a.role || '') + (isCustom ? ' · 本地' : ' · 内置') + '</div></div>' +
                '<div class="acts">' +
                '<button class="mini edt">编辑</button>' +
                (isCustom ? '<button class="mini del">删除</button>' : '<button class="mini default" disabled>内置</button>') +
                '</div>';
            item.querySelector('.edt').addEventListener('click', function () { openAdvisorModal(a, !!isCustom); });
            if (isCustom) item.querySelector('.del').addEventListener('click', function () { deleteAdvisor(a.id); });
            box.appendChild(item);
        });
    }

    function deleteAdvisor(id) {
        if (!window.confirm('删除这个本地角色？该角色的对话记录也会一并清除。')) return;
        state.customAdvisors = state.customAdvisors.filter(function (x) { return x.id !== id; });
        RA.Config.saveCustomAdvisors(state.customAdvisors);
        if (state.threads[id]) { delete state.threads[id]; save(); }
        refreshAdvisors(); renderAdvisorList();
    }

    /* ===================== 角色编辑弹层 ===================== */
    var editing = null; // {id, isCustom}
    function openAdvisorModal(a, isCustom) {
        editing = a ? { id: a.id, isCustom: isCustom } : { id: 'c_' + Date.now(), isCustom: true };
        $('am-title').textContent = a ? '编辑角色' : '新增角色';
        $('am-name').value = a ? a.name : '';
        $('am-role').value = a ? (a.role || '') : '';
        $('am-system').value = a ? (a.system || '') : '';
        // 知识库勾选（内置库标「内置」，可在此直接上传本地资料）
        renderKbGroup($('am-kbs'), a ? (a.kbIds || []) : []);
        $('am-delete').style.display = (a && isCustom) ? '' : 'none';
        $('advisorModal').classList.add('show'); $('advisorModal').setAttribute('aria-hidden', 'false');
    }
    function closeAdvisorModal() { $('advisorModal').classList.remove('show'); $('advisorModal').setAttribute('aria-hidden', 'true'); editing = null; }

    function saveAdvisorModal() {
        var name = $('am-name').value.trim();
        if (!name) { $('am-name').focus(); return; }
        var kbIds = Array.prototype.slice.call($('am-kbs').querySelectorAll('input:checked')).map(function (i) { return i.value; });
        var rec = {
            id: editing.id, name: name,
            role: $('am-role').value.trim(),
            system: $('am-system').value,
            kbIds: kbIds,
            desc: '',
            hint: '自定义角色 · 直接提问即可',
            samples: [],
            placeholder: '说说你的问题或方案…'
        };
        // 保留默认角色的源字段（若编辑的是默认）
        if (!editing.isCustom) {
            var def = state.defaultAdvisors.filter(function (x) { return x.id === editing.id; })[0];
            if (def) { rec.samples = def.samples; rec.hint = def.hint; rec.placeholder = def.placeholder; }
        }
        if (welcomeCreatePending && templateSrc) {
            rec.samples = templateSrc.samples || [];
            rec.hint = templateSrc.hint || rec.hint;
            rec.placeholder = templateSrc.placeholder || rec.placeholder;
        }
        if (editing.isCustom) {
            var i = state.customAdvisors.map(function (x) { return x.id; }).indexOf(editing.id);
            if (i >= 0) state.customAdvisors[i] = rec; else state.customAdvisors.push(rec);
            RA.Config.saveCustomAdvisors(state.customAdvisors);
        } else {
            // 编辑默认角色：以自定义覆盖（写入本地）
            state.customAdvisors.push(rec);
            RA.Config.saveCustomAdvisors(state.customAdvisors);
        }
        refreshAdvisors(); renderAdvisorList(); closeAdvisorModal();
        if (welcomeCreatePending) { welcomeCreatePending = false; templateSrc = null; switchTo(editing.id); enterWorkbench(); }
    }

    /* ===================== 知识库管理 ===================== */
    function renderKBList() {
        var box = $('kb-list'); box.innerHTML = '';
        state.allKbs.forEach(function (k) {
            var isCustom = k.source === 'custom';
            var item = document.createElement('div'); item.className = 'item';
            item.innerHTML =
                '<div class="info"><div class="t">' + esc(k.title) + '</div><div class="s">' + (isCustom ? (k.url ? '本地 · 来自网址' : '本地 · 仅你可见') : '内置') + '</div></div>' +
                '<div class="acts">' +
                (isCustom ? '<button class="mini del">删除</button>' : '<button class="mini default" disabled>内置</button>') +
                '</div>';
            if (isCustom) item.querySelector('.del').addEventListener('click', function () { deleteKB(k.id); });
            box.appendChild(item);
        });
    }
    function deleteKB(id) {
        if (!window.confirm('删除这条本地资料？')) return;
        RA.KB.delCustom(id).then(function () {
            return RA.KB.listAll();
        }).then(function (all) {
            state.allKbs = all; renderKBList(); updateKbLine(); renderAdvisorList();
        });
    }
    function addKB() {
        var title = $('kb-title').value.trim();
        if (!title) { $('kb-title').focus(); return; }
        var url = $('kb-url').value.trim();
        var content = $('kb-content').value.trim();
        var btn = $('kb-add');
        function setMsg(msg, ok) { var n = $('kb-msg'); n.textContent = msg || ''; n.className = 'kb-msg ' + (ok ? 'ok' : 'err'); }
        function store(text, srcUrl) {
            if (!text) { $('kb-content').focus(); return; }
            var rec = { id: 'c_' + Date.now(), title: title, content: text, url: srcUrl || '', createdAt: Date.now() };
            RA.KB.putCustom(rec).then(function () {
                return RA.KB.listAll();
            }).then(function (all) {
                state.allKbs = all;
                $('kb-title').value = ''; $('kb-url').value = ''; $('kb-content').value = '';
                setMsg('已保存到本机浏览器', true);
                renderKBList(); updateKbLine(); renderAdvisorList();
            });
        }
        // 填了网址且正文为空 → 先抓取再存（仍只存浏览器）
        if (url && !content) {
            btn.disabled = true; setMsg('正在从网址抓取…');
            fetch(url, { mode: 'cors' }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            }).then(function (t) {
                $('kb-content').value = t; btn.disabled = false; store(t.trim(), url);
            }).catch(function (e) {
                btn.disabled = false;
                setMsg('抓取失败：' + (e && e.message ? e.message : e) + '（多半是该网址不允许跨域，可改为本地粘贴）', false);
            });
            return;
        }
        store(content);
    }

    /* ===================== 初始化 ===================== */
    function autoGrow() { el.input.style.height = 'auto'; el.input.style.height = Math.min(el.input.scrollHeight, 132) + 'px'; }

    function init() {
        el = {
            msgs: $('msgs'), input: $('input'), send: $('send'), stop: $('stop'),
            tabs: $('tabs'), drawer: $('drawer'), overlay: $('overlay'),
            kbLine: $('kbLine'), keyBadge: $('keyBadge')
        };
        state.settings = RA.Config.getSettings();
        state.threads = RA.Config.getThreads();
        state.customAdvisors = RA.Config.getCustomAdvisors();

        Promise.all([
            fetch('./presets/advisors.json').then(function (r) { return r.json(); }).catch(function () { return { advisors: [] }; }),
            RA.KB.listAll().catch(function () { return []; })
        ]).then(function (res) {
            state.defaultAdvisors = res[0].advisors || [];
            state.allKbs = res[1] || [];
            buildAdvisors();
            if (!getAdvisor(state.advisor) && state.advisors.length) state.advisor = state.advisors[0].id;
            updateKeyBadge(); updateTabs(); render(); updateControls(); autoGrow();
            renderAdvisorList(); renderKBList(); updateKbLine();
            setupWelcome();
        }).catch(function (e) {
            el.msgs.innerHTML = '<div class="empty"><h3>加载失败</h3><div class="hint">无法读取预设文件。若你是用 file:// 直接打开本页，请改用本地服务器（见 README）：<br>在此目录运行 <code>python -m http.server 8000</code>，再访问 <code>http://localhost:8000</code></div></div>';
        });

        // 事件
        el.input.addEventListener('input', autoGrow);
        el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(el.input.value); } });
        el.send.addEventListener('click', function () { send(el.input.value); });
        el.stop.addEventListener('click', function () { var c = state.ctrl[state.advisor]; if (c) c.abort(); });

        el.msgs.addEventListener('click', function (e) {
            var node = e.target;
            while (node && node !== el.msgs) {
                if (node.className && String(node.className).indexOf('sample') === 0) { send(node.getAttribute('data-q')); return; }
                node = node.parentNode;
            }
        });

        $('openSettings').addEventListener('click', openSettings);
        $('closeSettings').addEventListener('click', closeSettings);
        el.overlay.addEventListener('click', closeSettings);
        $('set-temperature').addEventListener('input', function () { $('tempVal').textContent = this.value; });
        $('set-save').addEventListener('click', function () {
            state.settings.baseURL = $('set-baseURL').value.trim();
            state.settings.apiKey = $('set-apiKey').value.trim();
            state.settings.model = $('set-model').value.trim();
            state.settings.temperature = parseFloat($('set-temperature').value);
            if (RA.Config.saveSettings(state.settings)) { updateKeyBadge(); flashSetMsg('已保存到本机浏览器', true); }
            else flashSetMsg('保存失败：浏览器存储不可用', false);
        });

        $('add-advisor').addEventListener('click', function () { openAdvisorModal(null, true); });
        $('am-close').addEventListener('click', closeAdvisorModal);
        $('am-cancel').addEventListener('click', closeAdvisorModal);
        $('am-save').addEventListener('click', saveAdvisorModal);
        $('am-delete').addEventListener('click', function () { if (editing && editing.isCustom) deleteAdvisor(editing.id); });

        $('kb-add').addEventListener('click', addKB);
        $('kb-file').addEventListener('change', function (e) {
            var files = Array.prototype.slice.call(e.target.files || []);
            e.target.value = '';
            if (!files.length) return;
            var pending = files.length, n = $('kb-msg');
            n.textContent = '正在读取 ' + files.length + ' 个文件…'; n.className = 'kb-msg';
            files.forEach(function (f) {
                var reader = new FileReader();
                reader.onload = function () {
                    var rec = { id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), title: f.name.replace(/\.[^.]+$/, ''), content: String(reader.result), url: '', createdAt: Date.now() };
                    RA.KB.putCustom(rec).then(function () { return RA.KB.listAll(); }).then(function (all) {
                        state.allKbs = all; pending--;
                        if (pending <= 0) { renderKBList(); updateKbLine(); renderAdvisorList(); n.textContent = '已上传 ' + files.length + ' 个资料到本机浏览器'; n.className = 'kb-msg ok'; }
                    });
                };
                reader.readAsText(f);
            });
        });

        // 引导页
        $('w-save').addEventListener('click', saveWelcomeKey);
        $('w-create').addEventListener('click', wcCreate);
        $('w-skip').addEventListener('click', function () {
            hideWelcome();
            if (state.advisors.length) { state.advisor = state.advisors[0].id; updateTabs(); render(); updateControls(); updateKbLine(); }
        });
    }

    /* ===================== 引导页 ===================== */
    function setupWelcome() {
        // 已配置密钥的直接进工作台，不弹引导；否则默认先落引导页
        if (state.settings && state.settings.apiKey) { hideWelcome(); return; }
        // 预填已有设置
        $('w-baseURL').value = state.settings ? (state.settings.baseURL || '') : '';
        $('w-apiKey').value = state.settings ? (state.settings.apiKey || '') : '';
        $('w-model').value = state.settings ? (state.settings.model || '') : '';
        renderWelcomeRoles();
        var first = state.defaultAdvisors[0];
        if (first) selectWRole({ tpl: first });
        showWelcome();
    }
    function renderWelcomeRoles() {
        var box = $('welcome-roles'); box.innerHTML = '';
        var chips = [{ custom: true, name: '自定义', desc: '从空白创建' }];
        state.defaultAdvisors.forEach(function (a) {
            chips.push({ tpl: a, name: a.name, desc: a.role || '' });
        });
        chips.forEach(function (opt) {
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'welcome-role';
            chip.dataset.id = opt.custom ? '__custom__' : opt.tpl.id;
            chip.innerHTML = esc(opt.name) + (opt.desc ? '<span class="wrole-role">' + esc(opt.desc) + '</span>' : '');
            chip.addEventListener('click', function () { selectWRole(opt); });
            box.appendChild(chip);
        });
    }
    function selectWRole(opt) {
        Array.prototype.forEach.call($('welcome-roles').children, function (c) {
            c.classList.toggle('active', c.dataset.id === (opt.custom ? '__custom__' : opt.tpl.id));
        });
        var f = $('wc-form'); f.classList.remove('hidden');
        if (opt.custom) {
            $('wc-name').value = '';
            $('wc-role').value = '';
            $('wc-system').value = '';
            renderKbGroup($('wc-kbs'), []);
            $('wc-form-title').textContent = '创建角色（空白）';
        } else {
            var a = opt.tpl;
            $('wc-name').value = a.name;
            $('wc-role').value = a.role || '';
            $('wc-system').value = a.system || '';
            renderKbGroup($('wc-kbs'), a.kbIds || []);
            $('wc-form-title').textContent = '基于「' + a.name + '」创建（可改）';
        }
    }
    function renderKbGroup(grp, checkedIds) {
        grp.innerHTML = '';
        state.allKbs.forEach(function (k) {
            var checked = checkedIds.indexOf(k.id) >= 0 ? 'checked' : '';
            var suffix = k.source === 'custom' ? '（本地）' : '（内置）';
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" value="' + esc(k.id) + '" ' + checked + '>' + esc(k.title) + suffix;
            grp.appendChild(label);
        });
        // 操作区：上传本地资料 / 添加网址（GitHub 等可跨域链接）
        var wrap = document.createElement('div'); wrap.className = 'kb-up-wrap';

        // —— 上传本地资料（.md/.txt），多个文件分别入库 ——
        var upBtn = document.createElement('button');
        upBtn.type = 'button'; upBtn.className = 'mini kb-upload-btn'; upBtn.textContent = '＋ 上传本地资料';
        var upInp = document.createElement('input');
        upInp.type = 'file'; upInp.accept = '.md,.txt,.text'; upInp.multiple = true; upInp.hidden = true;
        upBtn.addEventListener('click', function () { upInp.click(); });
        upInp.addEventListener('change', function (e) {
            var files = Array.prototype.slice.call(e.target.files || []);
            upInp.value = '';
            if (!files.length) return;
            var newIds = (checkedIds || []).slice();
            var pending = files.length;
            files.forEach(function (f) {
                var reader = new FileReader();
                reader.onload = function () {
                    var rid = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                    var rec = { id: rid, title: f.name.replace(/\.[^.]+$/, ''), content: String(reader.result), url: '', createdAt: Date.now() };
                    RA.KB.putCustom(rec).then(function () { return RA.KB.listAll(); }).then(function (all) {
                        state.allKbs = all;
                        newIds.push(rid); pending--;
                        if (pending <= 0) { renderKbGroup(grp, newIds); renderKBList(); updateKbLine(); renderAdvisorList(); }
                    });
                };
                reader.readAsText(f);
            });
        });

        // —— 添加网址（粘贴 GitHub / 可跨域 raw 链接，抓取后存入本地并勾上） ——
        var urlBtn = document.createElement('button');
        urlBtn.type = 'button'; urlBtn.className = 'mini kb-url-btn'; urlBtn.textContent = '＋ 添加网址';
        var form = document.createElement('div'); form.className = 'kb-url-form hidden';
        form.innerHTML =
            '<input type="text" class="kb-url-name" placeholder="资料名称，如「我的产品手册」">' +
            '<input type="url" class="kb-url-input" placeholder="GitHub / 可跨域网址（如 raw.githubusercontent.com/.../x.md）">' +
            '<button type="button" class="mini kb-url-ok">获取</button>' +
            '<button type="button" class="mini kb-url-cancel">取消</button>' +
            '<div class="kb-url-msg"></div>';
        urlBtn.addEventListener('click', function () { form.classList.toggle('hidden'); });
        form.querySelector('.kb-url-cancel').addEventListener('click', function () { form.classList.add('hidden'); });
        form.querySelector('.kb-url-ok').addEventListener('click', function () {
            var t = form.querySelector('.kb-url-name').value.trim();
            var u = form.querySelector('.kb-url-input').value.trim();
            var msg = form.querySelector('.kb-url-msg');
            if (!t) { msg.textContent = '请填写资料名称'; msg.className = 'kb-url-msg err'; return; }
            if (!u) { msg.textContent = '请填写网址'; msg.className = 'kb-url-msg err'; return; }
            msg.textContent = '正在抓取…'; msg.className = 'kb-url-msg';
            fetch(u, { mode: 'cors' }).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            }).then(function (txt) {
                txt = String(txt).trim();
                if (!txt) throw new Error('抓取到的内容为空');
                var rid = 'c_' + Date.now();
                var rec = { id: rid, title: t, content: txt, url: u, createdAt: Date.now() };
                return RA.KB.putCustom(rec).then(function () { return RA.KB.listAll(); }).then(function (all) {
                    state.allKbs = all;
                    var newIds = (checkedIds || []).slice(); newIds.push(rid);
                    renderKbGroup(grp, newIds); renderKBList(); updateKbLine(); renderAdvisorList();
                    form.classList.add('hidden');
                });
            }).catch(function (e) {
                msg.textContent = '抓取失败：' + (e && e.message ? e.message : e) + '（多半是不允许跨域，改用粘贴/上传）';
                msg.className = 'kb-url-msg err';
            });
        });

        wrap.appendChild(upBtn); wrap.appendChild(upInp);
        wrap.appendChild(urlBtn); wrap.appendChild(form);
        grp.appendChild(wrap);
    }
    function wcCreate() {
        var name = $('wc-name').value.trim();
        if (!name) { $('wc-name').focus(); return; }
        var kbIds = Array.prototype.slice.call($('wc-kbs').querySelectorAll('input:checked')).map(function (i) { return i.value; });
        var id = 'c_' + Date.now();
        var rec = {
            id: id, name: name,
            role: $('wc-role').value.trim(),
            system: $('wc-system').value,
            kbIds: kbIds,
            desc: '',
            hint: '自定义角色 · 直接提问即可',
            samples: [],
            placeholder: '说说你的问题或方案…'
        };
        state.customAdvisors.push(rec);
        RA.Config.saveCustomAdvisors(state.customAdvisors);
        refreshAdvisors(); renderAdvisorList();
        hideWelcome(); switchTo(id);
    }
    function showWelcome() { $('welcome').setAttribute('aria-hidden', 'false'); }
    function hideWelcome() { $('welcome').setAttribute('aria-hidden', 'true'); }
    function saveWelcomeKey() {
        var base = $('w-baseURL').value.trim();
        var key = $('w-apiKey').value.trim();
        var model = $('w-model').value.trim();
        var n = $('w-msg');
        if (!key) { n.textContent = '请填写 API 密钥（必填）'; n.className = 'welcome-msg err'; $('w-apiKey').focus(); return; }
        state.settings.baseURL = base;
        state.settings.apiKey = key;
        state.settings.model = model;
        if (RA.Config.saveSettings(state.settings)) {
            updateKeyBadge();
            n.textContent = '已保存，可以进入工作台了'; n.className = 'welcome-msg ok';
            var tag = $('wstep-key-tag'); tag.textContent = '已完成'; tag.className = 'wstep-tag done';
            var note = $('w-enter-note'); note.textContent = '密钥已就绪，点击进入即可开始对话。';
        } else {
            n.textContent = '保存失败：浏览器存储不可用'; n.className = 'welcome-msg err';
        }
    }
    function enterWorkbench() {
        hideWelcome();
        if (pendingAdvisor && getAdvisor(pendingAdvisor)) switchTo(pendingAdvisor);
        else if (state.advisors.length) { state.advisor = state.advisors[0].id; updateTabs(); render(); updateControls(); updateKbLine(); }
    }

    function updateKeyBadge() {
        if (state.settings && state.settings.apiKey) { el.keyBadge.textContent = '已配置密钥'; el.keyBadge.classList.add('ok'); }
        else { el.keyBadge.textContent = '未配置密钥'; el.keyBadge.classList.remove('ok'); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
