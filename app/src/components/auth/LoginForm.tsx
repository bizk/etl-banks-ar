import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authSlice';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const loginMutation = useMutation({
    mutationFn: () => authApi.login(email, password),
    onSuccess: (data) => {
      setAuth(data.user, data.token);
      navigate('/');
    },
    onError: () => {
      setError('Invalid email or password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
          </div>
          <div>
            <h1 className="text-2xl font-headline font-bold text-primary">Etheric</h1>
            <p className="text-xs uppercase tracking-widest text-on-surface-variant">Precision Organicism</p>
          </div>
        </div>

        <h2 className="text-xl font-headline font-bold mb-6">Sign In</h2>

        {error && (
          <div className="bg-error/10 text-error px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none focus:ring-2 focus:ring-primary-container"
              placeholder="you@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-surface-container-low border-none focus:ring-2 focus:ring-primary-container"
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full bg-primary-container text-white font-headline font-bold py-3 px-4 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loginMutation.isPending ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-on-surface-variant">
          Don't have an account?{' '}
          <Link to="/register" className="text-primary font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
