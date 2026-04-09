import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

export default function LoginPage() {
  const { login, loginMagic, loginWithToken } = useAuth();
  const [mode, setMode] = useState('password'); // password | magic
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicVerifying, setMagicVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('magic_token');
    const googleToken = params.get('google_token');
    const googleUser = params.get('google_user');
    const googleError = params.get('google_error');
    const isMagicPath = window.location.pathname === '/auth/magic';
    const isRootPath = window.location.pathname === '/';
    if (googleError) {
      setError(googleError);
      window.history.replaceState({}, '', '/');
      return;
    }
    if (googleToken && googleUser) {
      try {
        const parsedUser = JSON.parse(googleUser);
        loginWithToken(googleToken, parsedUser)
          .then(() => {
            window.history.replaceState({}, '', '/');
          })
          .catch((err) => {
            setError(err.message || 'Connexion Google echouee');
          });
      } catch (err) {
        setError('Connexion Google echouee');
      }
      return;
    }
    if (!token || (!isMagicPath && !isRootPath)) return;

    let active = true;
    setMagicVerifying(true);
    setError('');

    loginMagic(token)
      .then(() => {
        if (!active) return;
        window.history.replaceState({}, '', '/');
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || 'Lien de connexion invalide ou expiré');
      })
      .finally(() => {
        if (active) setMagicVerifying(false);
      });

    return () => {
      active = false;
    };
  }, [loginMagic, loginWithToken]);

  useEffect(() => {
    let active = true;
    api.getGoogleLoginStatus()
      .then((data) => {
        if (active) setGoogleConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        if (active) setGoogleConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleMessage = async (event) => {
      const payload = event?.data;
      if (!payload || payload.type !== 'sep-auth-google') return;
      setGoogleLoading(false);
      if (!payload.ok) {
        setError(payload.message || 'Connexion Google echouee');
        return;
      }
      try {
        await loginWithToken(payload.access_token, payload.user);
      } catch (err) {
        setError(err.message || 'Connexion Google echouee');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [loginWithToken]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'password') {
        await login(email, password);
      } else {
        await api.requestMagicLink(email);
        setMagicSent(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const data = await api.startGoogleLogin();
      const popup = window.open(
        data?.url,
        'sep-google-login',
        'width=520,height=720',
      );
      if (!popup) {
        window.location.href = data?.url;
      }
    } catch (err) {
      setGoogleLoading(false);
      setError(err.message || 'Connexion Google indisponible');
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 40, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#1d4ed8', letterSpacing: -1 }}>Soins Expert Plus</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Plateforme de gestion du personnel de santé</div>
        </div>

        {magicVerifying ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Connexion en cours...</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              Validation du lien de connexion.
            </div>
          </div>
        ) : magicSent ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Vérifiez votre courriel</div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              Un lien de connexion a été envoyé à <strong>{email}</strong>. Il expire dans 15 minutes.
            </div>
            <button onClick={() => { setMagicSent(false); setMode('password'); }} className="btn btn-outline" style={{ marginTop: 20 }}>
              Retour
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
              <button type="button" onClick={() => setMode('password')}
                style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                  background: mode === 'password' ? 'white' : 'transparent', color: mode === 'password' ? '#1d4ed8' : '#6b7280',
                  boxShadow: mode === 'password' ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>
                Mot de passe
              </button>
              <button type="button" onClick={() => setMode('magic')}
                style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit',
                  background: mode === 'magic' ? 'white' : 'transparent', color: mode === 'magic' ? '#1d4ed8' : '#6b7280',
                  boxShadow: mode === 'magic' ? '0 1px 3px rgba(0,0,0,.1)' : 'none' }}>
                Magic link
              </button>
            </div>

            <div className="field">
              <label>Courriel</label>
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nom@exemple.com" required />
            </div>

            {mode === 'password' && (
              <div className="field">
                <label>Mot de passe</label>
                <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
            )}

            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, padding: '8px 12px', background: '#fee2e2', borderRadius: 8 }}>{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={loading || magicVerifying}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 14, marginTop: 4 }}>
              {loading ? 'Connexion...' : mode === 'password' ? 'Se connecter' : 'Envoyer le lien'}
            </button>

            {googleConfigured && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={handleGoogleLogin}
                disabled={googleLoading || loading || magicVerifying}
                style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 14, marginTop: 10 }}
              >
                {googleLoading ? 'Connexion Google...' : 'Continuer avec Google'}
              </button>
            )}
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#9ca3af' }}>
          9437-7827 Québec Inc. — Gestion Taief Inc.
        </div>
      </div>
    </div>
  );
}
