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
        var color = a && a.color ? a.color : '#8b5cf6';
        var mark = a && a.avatar ? a.avatar : '问';
        if (m.role === 'user') {
            return '<div class="turn user"><div class="avatar">我</div><div class="bubble"><div class="txt">' + md(m.content) + '</div></div></div>';
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
            '<div class="avatar" style="background:' + color + '">' + esc(mark) + '</div>' +
            '<div class="bubble"><div class="who">' + esc(a ? (a.name + (a.role ? ' · ' + a.role : '')) : '顾问') + '</div>' +
            '<div class="txt" style="border-left-color:' + color + '">' + body + '</div></div></div>';
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
        state.advisors.forEach(function (a) {
            var btn = document.createElement('button');
            btn.className = 'tab' + (a.id === state.advisor ? ' active' : '') + (state.running[a.id] ? '' : '');
            btn.setAttribute('data-advisor', a.id);
            if (state.running[a.id]) btn.setAttribute('data-running', '1');
            btn.innerHTML =
                '<div class="mark" style="background:' + (a.color || '#8b5cf6') + '">' + esc(a.avatar || '问') + '</div>' +
                '<div class="meta"><div class="name">' + esc(a.name) + (a.role ? '<span class="role">' + esc(a.role) + '</span>' : '') + '<span class="spin"></span></div>' +
                '<div class="desc">' + esc(a.desc || a.role || '') + '</div></div>';
            btn.addEventListener('click', function () { switchTo(a.id); });
            el.tabs.appendChild(btn);
        });
    }

    function updateKbLine() {
        var a = getAdvisor(state.advisor);
        var ids = (a && a.kbIds) || [];
        if (!ids.length) { el.kbLine.innerHTML = '当前角色<b>未挂接知识库</b> · 可在设置里编辑'; return; }
        var names = ids.map(function (id) {
            var k = state.allKbs.filter(function (x) { return x.id === id; })[0];
            return k ? k.title : null;
        }).filter(Boolean);
        el.kbLine.innerHTML = '当前角色挂接资料：<b>' + names.join('、') + '</b> · 可在设置里编辑';
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
    function closeSettings() { el.drawer.classList.remove('show'); el.overlay.classList.remove('show'); el.drawer.setAttribute('aria-hidden', 'true'); }

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
                '<div class="dot" style="background:' + (a.color || '#8b5cf6') + '">' + esc(a.avatar || '问') + '</div>' +
                '<div class="info"><div class="t">' + esc(a.name) + '</div><div class="s">' + esc(a.role || '') + (isCustom ? ' · 本地' : ' · 默认') + '</div></div>' +
                '<div class="acts">' +
                '<button class="mini edt">编辑</button>' +
                (isCustom ? '<button class="mini del">删除</button>' : '<button class="mini default" disabled>默认</button>') +
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
        $('am-avatar').value = a ? (a.avatar || '') : '';
        $('am-color').value = a ? (a.color || '#7c3aed') : '#7c3aed';
        $('am-role').value = a ? (a.role || '') : '';
        $('am-system').value = a ? (a.system || '') : '';
        // 知识库勾选
        var grp = $('am-kbs'); grp.innerHTML = '';
        state.allKbs.forEach(function (k) {
            var checked = a && (a.kbIds || []).indexOf(k.id) >= 0 ? 'checked' : '';
            var label = document.createElement('label');
            label.innerHTML = '<input type="checkbox" value="' + esc(k.id) + '" ' + checked + '>' + esc(k.title) + (k.source === 'custom' ? '（本地）' : '');
            grp.appendChild(label);
        });
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
            avatar: ($('am-avatar').value.trim() || name.charAt(0)),
            color: $('am-color').value,
            role: $('am-role').value.trim(),
            system: $('am-system').value,
            kbIds: kbIds,
            desc: $('am-role').value.trim(),
            hint: '自定义角色 · 直接提问即可',
            samples: [],
            placeholder: '说说你的问题或方案…'
        };
        // 保留默认角色的源字段（若编辑的是默认）
        if (!editing.isCustom) {
            var def = state.defaultAdvisors.filter(function (x) { return x.id === editing.id; })[0];
            if (def) { rec.samples = def.samples; rec.hint = def.hint; rec.placeholder = def.placeholder; }
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
    }

    /* ===================== 知识库管理 ===================== */
    function renderKBList() {
        var box = $('kb-list'); box.innerHTML = '';
        state.allKbs.forEach(function (k) {
            var isCustom = k.source === 'custom';
            var item = document.createElement('div'); item.className = 'item';
            item.innerHTML =
                '<div class="dot" style="background:#64748b">库</div>' +
                '<div class="info"><div class="t">' + esc(k.title) + '</div><div class="s">' + (isCustom ? '本地 · 仅你可见' : '默认 · 来自仓库') + '</div></div>' +
                '<div class="acts">' +
                (isCustom ? '<button class="mini del">删除</button>' : '<button class="mini default" disabled>默认</button>') +
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
        var content = $('kb-content').value.trim();
        if (!title) { $('kb-title').focus(); return; }
        if (!content) { $('kb-content').focus(); return; }
        var rec = { id: 'c_' + Date.now(), title: title, content: content, createdAt: Date.now() };
        RA.KB.putCustom(rec).then(function () {
            return RA.KB.listAll();
        }).then(function (all) {
            state.allKbs = all;
            $('kb-title').value = ''; $('kb-content').value = '';
            renderKBList(); updateKbLine(); renderAdvisorList();
        });
    }

    /* ===================== 初始化 ===================== */
    function autoGrow() { el.input.style.height = 'auto'; el.input.style.height = Math.min(el.input.scrollHeight, 132) + 'px'; }

    function init() {
        el = {
            msgs: $('msgs'), input: $('input'), send: $('send'), stop: $('stop'),
            reset: $('reset'), tabs: $('tabs'), drawer: $('drawer'), overlay: $('overlay'),
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
        }).catch(function (e) {
            el.msgs.innerHTML = '<div class="empty"><h3>加载失败</h3><div class="hint">无法读取预设文件。若你是用 file:// 直接打开本页，请改用本地服务器（见 README）：<br>在此目录运行 <code>python -m http.server 8000</code>，再访问 <code>http://localhost:8000</code></div></div>';
        });

        // 事件
        el.input.addEventListener('input', autoGrow);
        el.input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(el.input.value); } });
        el.send.addEventListener('click', function () { send(el.input.value); });
        el.stop.addEventListener('click', function () { var c = state.ctrl[state.advisor]; if (c) c.abort(); });
        el.reset.addEventListener('click', function () {
            var tid = state.advisor;
            if (state.running[tid]) return;
            if (!(state.threads[tid] || []).length) return;
            if (!window.confirm('清空与「' + (getAdvisor(tid) ? getAdvisor(tid).name : '当前角色') + '」的全部对话？')) return;
            state.threads[tid] = []; render(); updateControls(); save();
        });

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
            var f = e.target.files && e.target.files[0]; if (!f) return;
            var reader = new FileReader();
            reader.onload = function () { $('kb-content').value = reader.result; if (!$('kb-title').value.trim()) $('kb-title').value = f.name.replace(/\.[^.]+$/, ''); };
            reader.readAsText(f);
        });
    }

    function updateKeyBadge() {
        if (state.settings && state.settings.apiKey) { el.keyBadge.textContent = '已配置密钥'; el.keyBadge.classList.add('ok'); }
        else { el.keyBadge.textContent = '未配置密钥'; el.keyBadge.classList.remove('ok'); }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
