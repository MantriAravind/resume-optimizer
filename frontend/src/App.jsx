import { useState } from 'react'
import './App.css'

function App() {
  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleOptimize() {
    if (resumeText.trim() === '' || jobText.trim() === '') {
      setError('Please fill in both your resume and the job description.')
      return
    }

    setError('')
    setResult('')
    setLoading(true)

    try {
      const response = await fetch('http://localhost:3001/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jobText })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Something went wrong.')
        return
      }

      setResult(data)
    } catch (err) {
      setError('Could not connect to the server. Make sure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <header>
        <h1>AI Resume Optimizer</h1>
        <p>Tailor your resume to any job description in seconds.</p>
      </header>

      <main>
        <section>
          <h2>Your Resume</h2>
          <textarea
            placeholder="Paste your resume text here..."
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
          ></textarea>
        </section>

        <section>
          <h2>Job Description</h2>
          <textarea
            placeholder="Paste the job description here..."
            value={jobText}
            onChange={(e) => setJobText(e.target.value)}
          ></textarea>
        </section>

        <button onClick={handleOptimize} disabled={loading}>
          {loading ? 'Optimizing...' : 'Optimize My Resume'}
        </button>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        {result && (
          <section>
            <h2>Results</h2>
            <p><strong>ATS Score:</strong> {result.score}/100</p>
            <p><strong>Optimized Resume:</strong></p>
            <p>{result.optimizedResume}</p>
          </section>
        )}
      </main>
    </>
  )
}

export default App