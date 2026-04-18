(function initJobHackAIAuthPersistence(window) {
  'use strict';

  var FIREBASE_AUTH_STORAGE_KEY_PREFIX = 'firebase:authUser:';

  function getAuthPersistenceStores() {
    var stores = [];
    try {
      if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage);
    } catch (_) {}
    try {
      if (typeof localStorage !== 'undefined') stores.push(localStorage);
    } catch (_) {}
    return stores;
  }

  /** Prefer localStorage when values differ so cross-tab / navigation updates win over stale session copies. */
  function getCrossTabStoredValue(key) {
    var stores = getAuthPersistenceStores();
    for (var i = stores.length - 1; i >= 0; i--) {
      try {
        var value = stores[i].getItem(key);
        if (value !== null) return value;
      } catch (_) {}
    }
    return null;
  }

  function setCrossTabStoredValue(key, value) {
    var stores = getAuthPersistenceStores();
    for (var s = 0; s < stores.length; s++) {
      try {
        stores[s].setItem(key, value);
      } catch (_) {}
    }
  }

  function hasStoredAuthenticatedFlag() {
    try {
      return getAuthPersistenceStores().some(function (store) {
        try {
          return store.getItem('user-authenticated') === 'true';
        } catch (_) {
          return false;
        }
      });
    } catch (_) {
      return false;
    }
  }

  function hasFirebaseAuthPersistence() {
    try {
      return getAuthPersistenceStores().some(function (store) {
        try {
          for (var i = 0; i < store.length; i++) {
            var key = store.key(i);
            if (!key || key.indexOf(FIREBASE_AUTH_STORAGE_KEY_PREFIX) !== 0) continue;
            var value = store.getItem(key);
            if (value && value !== 'null' && value.length > 10) {
              return true;
            }
          }
        } catch (_) {}
        return false;
      });
    } catch (_) {
      return false;
    }
  }

  window.JobHackAIAuthPersistence = {
    FIREBASE_AUTH_STORAGE_KEY_PREFIX: FIREBASE_AUTH_STORAGE_KEY_PREFIX,
    getAuthPersistenceStores: getAuthPersistenceStores,
    getCrossTabStoredValue: getCrossTabStoredValue,
    setCrossTabStoredValue: setCrossTabStoredValue,
    hasStoredAuthenticatedFlag: hasStoredAuthenticatedFlag,
    hasFirebaseAuthPersistence: hasFirebaseAuthPersistence
  };
})(window);
