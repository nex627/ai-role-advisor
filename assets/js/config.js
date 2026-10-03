/* 本地存储管理：所有用户配置只存浏览器，绝不进仓库 */
window.RA = window.RA || {};

RA.Config = (function () {
    var K = {
        settings: 'airole.settings.v1',
        customAdvisors: 'airole.advisors.custom.v1',
        threads: 'airole.threads.v1'
    };

    function load(key, def) {
        try {
            var r = localStorage.getItem(key);
            return r ? JSON.parse(r) : def;
        } catch (e) { return def; }
    }
    function save(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch (e) { return false; }
    }

    return {
        KEYS: K,
        defaultSettings: function () {
            return { baseURL: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', temperature: 0.7 };
        },
        getSettings: function () {
            var s = load(K.settings, null);
            // 合并默认，避免旧数据缺字段
            return Object.assign(RA.Config.defaultSettings(), s || {});
        },
        saveSettings: function (s) { return save(K.settings, s); },

        getCustomAdvisors: function () { return load(K.customAdvisors, []); },
        saveCustomAdvisors: function (a) { return save(K.customAdvisors, a); },

        getThreads: function () { return load(K.threads, {}); },
        saveThreads: function (t) { return save(K.threads, t); }
    };
})();
