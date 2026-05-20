import { Editor } from './components/Editor'
import './App.css'

function App() {
  return (
    <div 
      className="absolute inset-0 flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-grid-bg)', padding: '20px', boxSizing: 'border-box' }}
    >
      <div className="flex-1 relative">
        <Editor />
      </div>
    </div>
  )
}

export default App


