import './App.css'
import { useTranslation } from 'react-i18next'
import { supportedLngs } from './config/.i18n'

function App() {
  const { t, i18n } = useTranslation()

  return (
    <div>
      <h1>{t('app.title')}</h1>
      <p>{t('app.subtitle')}</p>
      <p>{t('upload.files_count', { count: 3 })}</p>

      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        {supportedLngs.map((lng) => (
          <option key={lng} value={lng}>
            {lng}
          </option>
        ))}
      </select>
    </div>
  )
}

export default App
