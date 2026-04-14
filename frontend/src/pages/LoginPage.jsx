import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

const cardStyle = {
  background: 'rgba(255,255,255,0.98)',
  borderRadius: 24,
  padding: 'clamp(24px, 5vw, 40px)',
  width: 'min(460px, calc(100vw - 28px))',
  boxShadow: '0 22px 70px rgba(10, 37, 64, 0.24)',
  border: '1px solid rgba(255,255,255,0.7)',
};

export default function LoginPage() {
  const { login, loginMagic, loginWithToken } = useAuth();
  const [mode, setMode] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicVerifying, setMagicVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [passwordToken, setPasswordToken] = useState('');
  const [passwordTokenInfo, setPasswordTokenInfo] = useState(null);
  const [passwordTokenLoading, setPasswordTokenLoading] = useState(false);

  const passwordModeLabel = useMemo(() => {
    if (passwordTokenInfo?.purpose === 'reset') return 'Reinitialiser votre mot de passe';
    return 'Creer votre mot de passe';
  }, [passwordTokenInfo]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('magic_token');
    const googleToken = params.get('google_token');
    const googleUser = params.get('google_user');
    const googleError = params.get('google_error');
    const incomingPasswordToken = params.get('password_token');
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
      } catch {
        setError('Connexion Google echouee');
      }
      return;
    }

    if (incomingPasswordToken && isRootPath) {
      let active = true;
      setPasswordTokenLoading(true);
      setPasswordToken(incomingPasswordToken);
      setError('');
      setNotice('');
      api.getPasswordTokenInfo(incomingPasswordToken)
        .then((info) => {
          if (!active) return;
          setPasswordTokenInfo(info);
          setEmail(info?.email || '');
        })
        .catch((err) => {
          if (!active) return;
          setPasswordToken('');
          setPasswordTokenInfo(null);
          setError(err.message || 'Lien de mot de passe invalide ou expire');
          window.history.replaceState({}, '', '/');
        })
        .finally(() => {
          if (active) setPasswordTokenLoading(false);
        });
      return () => {
        active = false;
      };
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
        setError(err.message || 'Lien de connexion invalide ou expire');
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

  const clearTokenScreen = () => {
    setPasswordToken('');
    setPasswordTokenInfo(null);
    setPassword('');
    setConfirmPassword('');
    window.history.replaceState({}, '', '/');
  };

  const handlePrimarySubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (passwordToken && passwordTokenInfo) {
        if ((password || '').length < 8) {
          throw new Error('Le mot de passe doit contenir au moins 8 caracteres');
        }
        if (password !== confirmPassword) {
          throw new Error('Les deux mots de passe doivent correspondre');
        }
        const payload = await api.completePasswordToken(passwordToken, password);
        await loginWithToken(payload.access_token, payload.user);
        clearTokenScreen();
        return;
      }

      if (mode === 'password') {
        await login(email, password);
      } else if (mode === 'magic') {
        await api.requestMagicLink(email);
        setNotice(`Un lien de connexion a ete envoye a ${email}.`);
      } else if (mode === 'forgot') {
        await api.requestPasswordReset(email);
        setNotice(`Si ${email} existe dans le systeme, un lien de reinitialisation a ete envoye.`);
      }
    } catch (err) {
      setError(err.message || 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const data = await api.startGoogleLogin();
      const popup = window.open(data?.url, 'sep-google-login', 'width=520,height=720');
      if (!popup) {
        window.location.href = data?.url;
      }
    } catch (err) {
      setGoogleLoading(false);
      setError(err.message || 'Connexion Google indisponible');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '20px 14px',
        background:
          'radial-gradient(circle at top left, rgba(111, 177, 186, 0.32), transparent 28%), linear-gradient(135deg, #1b5e68 0%, #2A7B88 35%, #a7dce3 140%)',
      }}
    >
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 30, fontWeight: 800, color: '#1B5E68', letterSpacing: -1 }}>
            Soins Expert Plus
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
            Portail securise des employes et de l'equipe interne
          </div>
        </div>

        {magicVerifying || passwordTokenLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {passwordTokenLoading ? 'Preparation de votre acces...' : 'Connexion en cours...'}
            </div>
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              {passwordTokenLoading ? 'Validation du lien de mot de passe.' : 'Validation du lien de connexion.'}
            </div>
          </div>
        ) : passwordToken && passwordTokenInfo ? (
          <form onSubmit={handlePrimarySubmit}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: '#1B5E68' }}>
              <ShieldCheck size={18} />
              <div style={{ fontWeight: 700 }}>{passwordModeLabel}</div>
            </div>
            <div style={{ marginBottom: 18, padding: 14, borderRadius: 14, background: '#F0F9FA', border: '1px solid #D4E0E1' }}>
              <div style={{ fontSize: 12, color: '#5F6877', marginBottom: 4 }}>Compte portail</div>
              <div style={{ fontWeight: 700, color: '#1B5E68' }}>{passwordTokenInfo.name || 'Employe'}</div>
              <div style={{ fontSize: 13, color: '#5F6877', marginTop: 2 }}>{passwordTokenInfo.email}</div>
            </div>

            <div className="field">
              <label>Nouveau mot de passe</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 caracteres"
                required
              />
            </div>

            <div className="field">
              <label>Confirmer le mot de passe</label>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Retapez votre mot de passe"
                required
              />
            </div>

            {error && <ErrorBox message={error} />}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 14 }}
            >
              {loading ? 'Enregistrement...' : passwordTokenInfo?.purpose === 'reset' ? 'Reinitialiser mon mot de passe' : 'Creer mon mot de passe'}
            </button>

            <button
              type="button"
              className="btn btn-outline"
              onClick={clearTokenScreen}
              style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
            >
              Retour a la connexion
            </button>
          </form>
        ) : notice ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: '#1B5E68' }}>
              <Mail size={36} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Verifiez votre courriel</div>
            <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>{notice}</div>
            <button
              onClick={() => {
                setNotice('');
                setMode('password');
              }}
              className="btn btn-outline"
              style={{ marginTop: 20, justifyContent: 'center', width: '100%' }}
            >
              Retour
            </button>
          </div>
        ) : (
          <form onSubmit={handlePrimarySubmit}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
              <ModeButton active={mode === 'password'} onClick={() => setMode('password')}>
                Mot de passe
              </ModeButton>
              <ModeButton active={mode === 'magic'} onClick={() => setMode('magic')}>
                Magic link
              </ModeButton>
            </div>

            <div className="field">
              <label>Courriel</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nom@soins-expert-plus.com"
                required
              />
            </div>

            {mode === 'password' && (
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <label style={{ marginBottom: 0 }}>Mot de passe</label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setPassword('');
                      setConfirmPassword('');
                      setError('');
                    }}
                    style={{ background: 'none', color: '#2A7B88', fontSize: 12, fontWeight: 700 }}
                  >
                    Mot de passe oublie ?
                  </button>
                </div>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
            )}

            {mode === 'forgot' && (
              <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, background: '#F8FAFC', border: '1px solid #D4E0E1' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#1B5E68', marginBottom: 8 }}>
                  <KeyRound size={16} />
                  Reinitialiser mon mot de passe
                </div>
                <div style={{ fontSize: 13, color: '#5F6877', lineHeight: 1.6 }}>
                  Nous vous enverrons un lien securise pour choisir un nouveau mot de passe.
                </div>
              </div>
            )}

            {error && <ErrorBox message={error} />}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || magicVerifying}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 0', fontSize: 14, marginTop: 4 }}
            >
              {loading
                ? 'Chargement...'
                : mode === 'password'
                  ? 'Se connecter'
                  : mode === 'magic'
                    ? 'Envoyer le lien'
                    : 'Envoyer le lien de reinitialisation'}
            </button>

            {mode === 'forgot' && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setMode('password')}
                style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
              >
                Retour a la connexion
              </button>
            )}

            {googleConfigured && mode !== 'forgot' && (
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

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #e5e7eb', color: '#6b7280', fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: '#1B5E68', marginBottom: 4 }}>
            <Mail size={14} />
            Besoin d'aide ?
          </div>
          Si vous avez un souci d'acces, vous pouvez contacter l'equipe RH ou utiliser l'option de reinitialisation du mot de passe.
        </div>
      </div>
    </div>
  );
}

function ModeButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: '9px 0',
        borderRadius: 8,
        fontWeight: 700,
        fontSize: 13,
        background: active ? 'white' : 'transparent',
        color: active ? '#1B5E68' : '#6b7280',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function ErrorBox({ message }) {
  return (
    <div style={{ color: '#b42318', fontSize: 13, marginBottom: 12, padding: '10px 12px', background: '#fee4e2', borderRadius: 10 }}>
      {message}
    </div>
  );
}
