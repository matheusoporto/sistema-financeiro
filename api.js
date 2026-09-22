/* Autenticação por cookie e sincronização dos dados da conta. */
(() => {
  'use strict';
  let csrfToken = '';
  function cacheId() {
    // getRandomValues também funciona em HTTP na LAN, onde randomUUID não está disponível.
    return Array.from(crypto.getRandomValues(new Uint8Array(16)),byte => byte.toString(16).padStart(2,'0')).join('');
  }
  class APIError extends Error {
    constructor(message, status = 0, payload = {}) { super(message); this.status = status; this.payload = payload; }
  }
  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`/api/${path}`, {
        method:options.method || 'GET', credentials:'same-origin', cache:'no-store',
        headers:{'Content-Type':'application/json','X-Requested-With':'finanto',...(csrfToken ? {'X-CSRF-Token':csrfToken} : {}),...(options.accountId ? {'X-Finanto-Account':options.accountId} : {})},
        ...(options.body === undefined ? {} : {body:JSON.stringify(options.body)}),
        signal:AbortSignal.timeout(15000),
      });
    } catch { throw new APIError('Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.'); }
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (response.status === 403 && options.accountId && !options.retried) {
      const session = await request('session');
      if (session.user?.id !== options.accountId) throw new APIError('Sua sessão mudou. Entre novamente.',401);
      return request(path,{...options,retried:true});
    }
    if (!response.ok) throw new APIError(payload.error || 'Não foi possível concluir esta operação.',response.status,payload);
    if (payload.csrfToken) csrfToken = payload.csrfToken;
    if (path === 'logout' || payload.user === null) csrfToken = '';
    return payload;
  }
  class AccountStore {
    constructor(userId, callbacks = {}) {
      this.userId = userId;
      this.key = `finanto.account.${userId}.data.v1`;
      this.pendingKey = `${this.key}.pending.${cacheId()}`;
      this.pointerKey = `${this.key}.pending-pointer`;
      this.recoveredPending = null;
      this.callbacks = callbacks;
      this.revision = 0;
      this.data = null;
      this.dirty = false;
      this.conflict = false;
      this.closed = false;
      this.sequence = 0;
      this.inFlight = null;
      this.timer = null;
      this.localError = '';
      this.status = {kind:'loading',message:'Carregando sua conta…'};
    }
    emit(kind, message) {
      if (this.closed) return;
      this.status = {kind,message,localError:this.localError};
      this.callbacks.onStatus?.(this.status);
    }
    cache() {
      if (!this.data || this.closed) return;
      try {
        const snapshot = JSON.stringify({revision:this.revision,data:this.data,dirty:this.dirty,updatedAt:Date.now()});
        if (this.dirty) {
          // Uma aba nunca substitui a única cópia das pendências de outra.
          localStorage.setItem(this.pendingKey,snapshot);
          try { sessionStorage.setItem(this.pointerKey,this.pendingKey); } catch { /* load também procura pendências desta conta. */ }
        } else {
          localStorage.setItem(this.key,snapshot);
          localStorage.removeItem(this.pendingKey);
          this.clearRecoveredPending();
        }
        this.localError = '';
      } catch { this.localError = 'A cópia neste navegador está indisponível. Mantenha a conexão até o servidor confirmar o salvamento.'; }
    }
    clearRecoveredPending() {
      const recovered = this.recoveredPending;
      if (recovered && localStorage.getItem(recovered.key) === recovered.raw) localStorage.removeItem(recovered.key);
      this.recoveredPending = null;
    }
    readPending() {
      try {
        let preferred;
        try { preferred = sessionStorage.getItem(this.pointerKey); } catch { /* Usa a pendência mais recente. */ }
        const keys = Array.from({length:localStorage.length},(_,index) => localStorage.key(index)).filter((key) => key?.startsWith(`${this.key}.pending.`));
        const candidates = keys.map((key) => {
          try {
            const raw = localStorage.getItem(key), value = JSON.parse(raw);
            if (!value?.dirty || !Number.isSafeInteger(value.revision) || value.revision < 0) return null;
            value.data = window.Finance.validateBackup(value.data);
            return {key,raw,value};
          } catch { return null; }
        }).filter(Boolean).sort((a,b) => Number(b.key === preferred)-Number(a.key === preferred) || (b.value.updatedAt || 0)-(a.value.updatedAt || 0));
        if (candidates.length) {
          this.recoveredPending = {key:candidates[0].key,raw:candidates[0].raw};
          return candidates[0].value;
        }
        // Compatibilidade com o cache anterior à separação por aba.
        const old = JSON.parse(localStorage.getItem(this.key));
        return old?.dirty ? old : null;
      } catch { return null; }
    }
    async load() {
      const remote = await request('data',{accountId:this.userId});
      if (this.closed) return null;
      this.revision = remote.revision;
      const cache = this.readPending();
      if (cache?.dirty && cache.data) {
        try { this.data = window.Finance.validateBackup(cache.data); } catch { this.data = null; }
        if (this.data) {
          this.dirty = true;
          if (cache.revision !== remote.revision && JSON.stringify(this.data) !== JSON.stringify(remote.data)) {
            this.revision = cache.revision;
            this.conflict = true;
            this.cache();
            this.emit('conflict','Há alterações pendentes neste dispositivo e uma versão mais recente no servidor.');
            this.callbacks.onConflict?.(remote);
          } else if (JSON.stringify(this.data) === JSON.stringify(remote.data)) {
            this.dirty = false; this.cache(); this.emit('saved','Salvo na sua conta');
          } else {
            this.cache();
            this.emit('saving','Retomando alterações pendentes…');
            this.timer = setTimeout(() => this.flush().catch(() => {}),300);
          }
          return this.data;
        }
      }
      this.data = remote.data;
      this.cache(); this.emit('saved','Salvo na sua conta');
      return this.data;
    }
    save(data) {
      if (this.closed || this.conflict) return;
      this.data = JSON.parse(JSON.stringify(data));
      this.dirty = true; this.sequence++; this.cache();
      this.emit('saving','Salvando na sua conta…');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush().catch(() => {}),300);
    }
    async flush() {
      clearTimeout(this.timer);
      if (this.closed) return;
      if (this.conflict) throw new APIError('Carregue a versão atual da conta antes de continuar.',409);
      if (this.inFlight) return this.inFlight;
      this.inFlight = (async () => {
        while (this.dirty && !this.closed && !this.conflict) {
          const sequence = this.sequence;
          const data = this.data;
          try {
            const result = await request('data',{method:'PUT',body:{data,revision:this.revision},accountId:this.userId});
            if (this.closed) return;
            this.revision = result.revision;
            this.dirty = this.sequence !== sequence;
            this.cache();
            this.emit(this.dirty ? 'saving' : 'saved',this.dirty ? 'Salvando na sua conta…' : 'Salvo na sua conta');
          } catch (error) {
            if (this.closed) return;
            if (error.status === 409) {
              if (JSON.stringify(error.payload.data) === JSON.stringify(data)) {
                this.revision = error.payload.revision;
                this.dirty = this.sequence !== sequence;
                this.cache(); this.emit(this.dirty ? 'saving' : 'saved',this.dirty ? 'Salvando na sua conta…' : 'Salvo na sua conta');
                continue;
              }
              this.conflict = true;
              this.cache();
              this.emit('conflict','Sua conta mudou em outro dispositivo. Resolva as alterações pendentes para continuar.');
              this.callbacks.onConflict?.(error.payload);
            } else if (error.status === 401) {
              this.emit('error','Sua sessão expirou. Entre novamente para salvar as alterações pendentes.');
              this.callbacks.onExpired?.();
            } else this.emit('error',`${error.message} Suas alterações estão pendentes neste dispositivo.`);
            throw error;
          }
        }
      })();
      try { await this.inFlight; } finally { this.inFlight = null; }
    }
    async refresh() {
      if (this.closed || this.inFlight || this.conflict) return;
      if (this.dirty) { await this.flush(); return; }
      const revision = this.revision;
      const sequence = this.sequence;
      const remote = await request('data',{accountId:this.userId});
      if (this.closed || this.inFlight || this.dirty || this.sequence !== sequence || this.revision !== revision) return;
      if (remote.revision === revision) { this.emit('saved','Salvo na sua conta'); return; }
      if (this.callbacks.isEditing?.()) {
        this.conflict = true;
        this.emit('conflict','Sua conta mudou em outro dispositivo enquanto este formulário estava aberto.');
        this.callbacks.onConflict?.(remote);
        return;
      }
      this.data = remote.data; this.revision = remote.revision; this.cache();
      this.emit('saved','Salvo na sua conta'); this.callbacks.onRemote?.(remote.data);
    }
    async useRemote() {
      const remote = await request('data',{accountId:this.userId});
      if (this.closed) return null;
      if (this.dirty && this.data) {
        try { localStorage.setItem(`${this.key}.backup.${cacheId()}`,JSON.stringify(this.data)); }
        catch { throw new APIError('Baixe suas alterações pendentes antes de carregar outra versão: o navegador não conseguiu guardar uma cópia.'); }
      }
      this.conflict = false; this.dirty = false; this.data = remote.data; this.revision = remote.revision;
      this.sequence++; this.cache(); this.emit('saved','Salvo na sua conta');
      return remote.data;
    }
    close(clearCache = false) {
      this.closed = true; clearTimeout(this.timer);
      if (clearCache) { try { localStorage.removeItem(this.key); } catch { /* A próxima conta usa uma chave própria. */ } }
    }
  }
  window.FinantoAPI = Object.freeze({request,AccountStore,APIError});
})();
