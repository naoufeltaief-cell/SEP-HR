import { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(api.user);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (api.isAuthenticated()) {
      api.getMe()
        .then(u => { setUser(u); api.user = u; })
        .catch(() => { api.clearAuth(); setUser(null); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.login(email, password);
    api.setAuth(res.access_token, res.user);
    setUser(res.user);
    return res.user;
  };

  const loginMagic = async (token) => {
    const res = await api.verifyMagicLink(token);
    api.setAuth(res.access_token, res.user);
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    api.clearAuth();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, loginMagic, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
