export const colors = {
  bg: '#0B1220',
  card: '#141C2F',
  cardAlt: '#1B2540',
  border: '#26314F',
  text: '#F1F5F9',
  muted: '#94A3B8',
  primary: '#A3E635', // verde-limão
  primaryText: '#0B1220',
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#60A5FA',
};

export const CATEGORIES = ['Musculação', 'Cardio', 'Funcional', 'Mobilidade', 'Esporte'];

export const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
