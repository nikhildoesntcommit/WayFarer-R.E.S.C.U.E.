import { useEffect } from 'react';
import { AppRoutes } from './routes';
import { initPersistence } from './persistence/db';

export function App() {
  useEffect(() => {
    void initPersistence();
  }, []);
  return <AppRoutes />;
}
