/* 直连大模型（OpenAI 兼容接口），密钥来自用户本地设置，不经过任何后端 */
window.RA = window.RA || {};

RA.LLM = (function () {

    // SSE 流式解析：与现有顾问页同款逻辑，已验证可用
    function stream(opts) {
        var base = (opts.baseURL || '').replace(/\/+$/, '');
        var url = base + '/chat/completions';

        var body = {
            model: opts.model,
            messages: opts.messages,
            stream: true,
            temperature: (opts.temperature != null ? opts.temperature : 0.7)
        };

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + opts.apiKey
            },
            signal: opts.signal,
            body: JSON.stringify(body)
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    throw new Error('接口返回 ' + res.status + (t ? '：' + t.slice(0, 160) : ''));
                });
            }
            if (!res.body) throw new Error('浏览器不支持流式读取');

            var reader = res.body.getReader();
            var dec = new TextDecoder();
            var buf = '';
            var sawDone = false;

            function pump() {
                return reader.read().then(function (r) {
                    if (r.done) return;
                    buf += dec.decode(r.value, { stream: true });
                    var parts = buf.split('\n');
                    buf = parts.pop();
                    var got = false;
                    for (var i = 0; i < parts.length; i++) {
                        var line = parts[i].trim();
                        if (line.indexOf('data:') !== 0) continue;
                        var payload = line.slice(5).trim();
                        if (!payload) continue;
                        if (payload === '[DONE]') { sawDone = true; continue; }
                        try {
                            var j = JSON.parse(payload);
                            var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
                            if (delta) { got = true; opts.onDelta(delta); }
                        } catch (e) { /* 半截帧，等下个 chunk */ }
                    }
                    if (got && opts.onFlush) opts.onFlush();
                    if (sawDone) {
                        setTimeout(function () { try { reader.cancel(); } catch (e) {} }, 300);
                        return;
                    }
                    return pump();
                });
            }
            return pump();
        }).then(function () {
            opts.onDone && opts.onDone();
        }).catch(function (e) {
            if (e && e.name === 'AbortError') {
                opts.onAbort && opts.onAbort();
            } else {
                opts.onError && opts.onError(e);
            }
        });
    }

    return { stream: stream };
})();
