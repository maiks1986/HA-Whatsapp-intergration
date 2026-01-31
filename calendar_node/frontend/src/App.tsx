import { useState, useEffect } from 'react'
import { Calendar, CheckCircle, AlertCircle, ExternalLink, Key } from 'lucide-react'
import axios, { AxiosError } from 'axios'
import { 
  HealthResponse, 
  AuthUrlResponse, 
  TokenExchangeResponse, 
  TokenExchangeRequest 
} from './types/shared_schemas'

function App() {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [version, setVersion] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  const checkHealth = async () => {
    try {
      const response = await axios.get<HealthResponse>('./health')
      setStatus('ok')
      setVersion(response.data.version)
      setIsAuthorized(response.data.authorized)
      
      if (!response.data.authorized) {
        fetchAuthUrl()
      }
    } catch (err) {
      console.error('Health check failed:', err)
      setStatus('error')
    }
  }

  const fetchAuthUrl = async () => {
    try {
      const response = await axios.get<AuthUrlResponse>('./api/auth/url')
      setAuthUrl(response.data.url)
    } catch (err) {
      console.error('Failed to fetch auth URL:', err)
    }
  }

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code) return

    setIsSubmitting(true)
    setMessage({ type: '', text: '' })

    try {
      await axios.post<TokenExchangeResponse, any, TokenExchangeRequest>('./api/auth/token', { code })
      setMessage({ type: 'success', text: 'Successfully authorized!' })
      setIsAuthorized(true)
      checkHealth()
    } catch (err) {
      const error = err as AxiosError<TokenExchangeResponse>;
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Failed to authorize. Check the console.' 
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    checkHealth()
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-700">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-blue-500 rounded-lg">
            <Calendar size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Calendar Master</h1>
            <p className="text-slate-400 text-sm">v{version || '0.0.1'}</p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-slate-900 rounded-xl">
            <span className="text-slate-300">System Status</span>
            {status === 'loading' && <span className="text-blue-400 animate-pulse">Checking...</span>}
            {status === 'ok' && (
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle size={20} />
                <span>Connected</span>
              </div>
            )}
            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle size={20} />
                <span>Error</span>
              </div>
            )}
          </div>

          {!isAuthorized && status === 'ok' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-sm">
                Google Calendar access is not yet authorized. Please follow the steps below.
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Step 1: Get Code</h3>
                <a 
                  href={authUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full p-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-medium transition-colors"
                >
                  <ExternalLink size={18} />
                  Login with Google
                </a>
              </div>

              <form onSubmit={handleAuthorize} className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Step 2: Enter Code</h3>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <input 
                      type="text" 
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="Enter authorization code"
                      className="w-full pl-10 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <button 
                    disabled={!code || isSubmitting}
                    className="px-6 py-3 bg-white text-slate-900 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isSubmitting ? '...' : 'Submit'}
                  </button>
                </div>
              </form>

              {message.text && (
                <div className={`p-3 rounded-lg text-sm ${message.type === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                  {message.text}
                </div>
              )}
            </div>
          )}

          {isAuthorized && (
            <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
              <div className="flex items-center gap-3 text-green-400 mb-2">
                <CheckCircle size={20} />
                <span className="font-bold">Authorized</span>
              </div>
              <p className="text-slate-400 text-sm">
                Successfully connected to Google Calendar. The "Personal Secretary" can now manage your schedule.
              </p>
            </div>
          )}

          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-sm">
            Note: Ensure you have set your <code className="bg-blue-500/20 px-1 rounded">google_client_id</code> and <code className="bg-blue-500/20 px-1 rounded">google_client_secret</code> in the Add-on options.
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
