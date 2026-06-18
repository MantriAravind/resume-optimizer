import { useState } from 'react'
import './App.css'

function App() {
  const [resumeText, setResumeText] = useState('')
  const [jobText, setJobText] = useState('')
  const [result, setResult] = useState('Your ATS score and optimized resume will appear here.')

  function handleOptimize() {
    if (resumeText.trim() === '' || jobText.trim() === '') {
      setResult('Please fill in both your resume and the job description.')
      return
    }
    setResult(`Resume length: ${resumeText.length} characters. Job description length: ${jobText.length} characters.`)
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

        <button onClick={handleOptimize}>Optimize My Resume</button>

        <section>
          <h2>Results</h2>
          <p>{result}</p>
        </section>
      </main>
    </>
  )
}

export default App