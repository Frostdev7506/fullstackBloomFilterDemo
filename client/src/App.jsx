import { useEffect, useRef, useState } from 'react'
import { checkEmail, register as registerApi } from './api'
import './index.css'

function StatusPill({ state, text }) {
  const map = {
    idle: { label: 'Idle', cls: 'pill' },
    checking: { label: 'Checking…', cls: 'pill pill-info' },
    miss: { label: 'Not in set', cls: 'pill pill-ok' },
    maybe: { label: 'Maybe in set', cls: 'pill pill-warn' }
  }
  const m = map[state] || map.idle
  return <span className={m.cls} title={text}>{m.label}</span>
}

export default function App() {
  const [name, setName] = useState('Jane Doe')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle')
  const [hint, setHint] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  let isEmailValid = /.+@.+\..+/.test(email)

  useEffect(() => () => clearTimeout(timer.current), [])

  const onEmailChange = (e) => {
    const value = e.target.value
    setEmail(value)
    setResult(null)
    setError(null)
    if (!value || !isEmailValid) {
      setStatus('idle'); setHint(''); return
    }
    setStatus('checking')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await checkEmail(value.trim())
        setStatus(res.maybePresent ? 'maybe' : 'miss')
        setHint(res.meaning)
      } catch {
        setStatus('idle')
        setHint('')
      }
    }, 350)
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setResult(null)
    try {
      const data = await registerApi(name.trim(), email.trim())
      setResult(data)
    } catch (err) {
      if(err.status === 409) {
        return setError('This email is already registered.')
      }
      setError(err.message || 'Registration failed')
    }
  }

  return (
    <div className="wrap">
      <header>
        <h1>Bloom Filter Sign-up Demo</h1>
      </header>

      <main>
        <form className="card" onSubmit={onSubmit}>
          <div className="row">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </div>
          <div className="row">
            <label>Email</label>
            <input
              value={email}
              onChange={onEmailChange}
              placeholder="you@example.com"
              required
              type="email"
            />
            <div className="status">
              <StatusPill state={status} text={hint} />
              <small>{hint}</small>
            </div>
          </div>
          <button type="submit" disabled={!email || !/.+@.+\..+/.test(email)}>Create account</button>

          {result && (
            <div className="notice ok">
              <strong>Success!</strong>
              <div>User <code>{result.user.email}</code> created via <em>{result.via}</em>.</div>
            </div>
          )}
          {error && (
            <div className="notice warn">
              <strong>Oops:</strong> {error}
            </div>
          )}
        </form>
      </main>
    </div>
  )
}
