import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import es from '../locales/es.json';
import ca from '../locales/ca.json';

const initialLang = (typeof localStorage !== 'undefined' && localStorage.getItem('app_lang')) || 'en';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      ca: { translation: ca },
    },
    lng: initialLang,
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'ca'],
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
