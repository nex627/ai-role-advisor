/* 知识库：默认来自仓库 .md（运行时 fetch），自定义存浏览器（IndexedDB，失败回退 localStorage）
   检索：客户端分块 + 关键词（CJK 二元 + ASCII 词）打分，取 top N 注入，无需任何后端 / embedding */
window.RA = window.RA || {};

RA.KB = (function () {
    var manifestCache = null;
    var contentCache = {};            // 默认知识库 id -> 正文
    var DB_NAME = 'airole', STORE = 'kbs', LS_KEY = 'airole.kbs.custom.v1';

    /* ---------- 默认知识库（仓库文件） ---------- */
    function loadManifest() {
        if (manifestCache) return Promise.resolve(manifestCache);
        return fetch('./kb/manifest.json', { cache: 'no-cache' })
            .then(function (r) { if (!r.ok) throw new Error('清单 ' + r.status); return r.json(); })
            .then(function (j) { manifestCache = j; return j; });
    }
    function getDefaultContent(id) {
        if (contentCache[id] != null) return Promise.resolve(contentCache[id]);
        return loadManifest().then(function (m) {
            var kb = (m.kbs || []).filter(function (x) { return x.id === id; })[0];
            if (!kb) throw new Error('未找到默认知识库 ' + id);
            // 优先用 manifest 里登记的 url（可指向任意公开 GitHub / 可跨域网址），否则用仓库本地文件
            var src = (kb.url && String(kb.url).trim()) ? kb.url : ('./' + kb.file);
            return fetch(src, { cache: 'no-cache' })
                .then(function (r) { if (!r.ok) throw new Error('知识库 ' + r.status); return r.text(); });
        }).then(function (t) { contentCache[id] = t; return t; });
    }

    /* ---------- 自定义知识库（浏览器） ---------- */
    function openDB() {
        return new Promise(function (res, rej) {
            if (!window.indexedDB) { rej(new Error('no-idb')); return; }
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
            req.onsuccess = function () { res(req.result); };
            req.onerror = function () { rej(req.error); };
        });
    }
    function idbAll() {
        return openDB().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
                tx.onsuccess = function () { res(tx.result || []); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function idbPut(kb) {
        return openDB().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(kb);
                tx.onsuccess = function () { res(true); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function idbDel(id) {
        return openDB().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
                tx.onsuccess = function () { res(true); };
                tx.onerror = function () { rej(tx.error); };
            });
        });
    }
    function lsAll() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; } }
    function lsSave(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch (e) {} }

    function getCustomAll() { return idbAll().catch(function () { return lsAll(); }); }
    function putCustom(kb) {
        return idbPut(kb).catch(function () {
            var arr = lsAll(), i = arr.filter(function (x) { return x.id === kb.id; })[0];
            if (i) Object.assign(i, kb); else arr.push(kb);
            lsSave(arr); return true;
        });
    }
    function delCustom(id) {
        return idbDel(id).catch(function () {
            lsSave(lsAll().filter(function (x) { return x.id !== id; })); return true;
        });
    }
    function getCustomContent(id) {
        return getCustomAll().then(function (arr) {
            var kb = arr.filter(function (x) { return x.id === id; })[0];
            return kb ? kb.content : '';
        });
    }

    /* ---------- 列表 ---------- */
    function listAll() {
        return loadManifest().then(function (m) {
            return getCustomAll().then(function (custom) {
                var defaults = (m.kbs || []).map(function (x) { return { id: x.id, title: x.title, source: 'default' }; });
                var customs = custom.map(function (x) { return { id: x.id, title: x.title, source: 'custom' }; });
                return defaults.concat(customs);
            });
        });
    }

    /* ---------- 检索 ---------- */
    function tokenize(text) {
        var tokens = [], m, re = /[a-z0-9]+/gi;
        while ((m = re.exec(text))) tokens.push(m[0].toLowerCase());
        var seq = (text.match(/[一-鿿]+/g) || []).join('');
        for (var i = 0; i < seq.length - 1; i++) tokens.push(seq.substr(i, 2));
        return tokens;
    }
    function chunk(text) {
        var paras = text.split(/\n{1,}/).map(function (s) { return s.trim(); }).filter(Boolean);
        var chunks = [], cur = '', LIMIT = 480;
        paras.forEach(function (p) {
            if ((cur + '\n' + p).length > LIMIT) { if (cur) chunks.push(cur); cur = p; }
            else cur = cur ? cur + '\n' + p : p;
        });
        if (cur) chunks.push(cur);
        if (!chunks.length && text.trim()) chunks.push(text.trim());
        return chunks;
    }
    function scoreChunk(ctokens, qfreq) {
        var cf = {}; ctokens.forEach(function (t) { cf[t] = (cf[t] || 0) + 1; });
        var score = 0;
        for (var t in qfreq) if (cf[t]) score += Math.min(cf[t], qfreq[t]) * (1 + Math.log(1 + cf[t]));
        return score / Math.sqrt(ctokens.length || 1);
    }
    function retrieve(query, kbList, opts) {
        opts = opts || {}; var topN = opts.topN || 5, maxChars = opts.maxChars || 3500;
        if (!kbList || !kbList.length) return Promise.resolve('');
        var qtokens = tokenize(query);
        if (!qtokens.length) return Promise.resolve('');
        var qfreq = {}; qtokens.forEach(function (t) { qfreq[t] = (qfreq[t] || 0) + 1; });

        var tasks = kbList.map(function (kb) {
            var p = kb.source === 'default' ? getDefaultContent(kb.id) : getCustomContent(kb.id);
            return p.then(function (content) {
                return chunk(content).map(function (c) {
                    return { text: c, score: scoreChunk(tokenize(c), qfreq), src: kb.title };
                });
            }).catch(function () { return []; });
        });
        return Promise.all(tasks).then(function (results) {
            var all = []; results.forEach(function (a) { all = all.concat(a); });
            all.sort(function (a, b) { return b.score - a.score; });
            var picked = all.filter(function (x) { return x.score > 0; }).slice(0, topN);
            if (!picked.length) return '';
            var out = '', total = 0;
            picked.forEach(function (x) {
                if (total + x.text.length > maxChars) return;
                out += '\n\n【资料：' + x.src + '】\n' + x.text; total += x.text.length;
            });
            return out.trim();
        });
    }

    return {
        loadManifest: loadManifest, listAll: listAll,
        getDefaultContent: getDefaultContent, getCustomAll: getCustomAll,
        putCustom: putCustom, delCustom: delCustom, retrieve: retrieve
    };
})();
