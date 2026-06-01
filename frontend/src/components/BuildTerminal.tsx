import { useEffect, useRef, useState } from 'react'

interface BuildTerminalProps {
  buildId: number
  buildName: string
  onClose: () => void
}

export default function BuildTerminal({ buildId, buildName, onClose }: BuildTerminalProps) {
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/build/${buildId}`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      setLogs(prev => [...prev, event.data].slice(-1000))
    }
    ws.onerror = () => {
      setLogs(prev => [...prev, '[Terminal] WebSocket connection error\n'])
    }
    ws.onclose = () => {
      setLogs(prev => [...prev, '[Terminal] Connection closed\n'])
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [buildId])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-8 z-50">
      <div className="glass-card w-full max-w-5xl h-[80vh] p-0 flex flex-col overflow-hidden border-brand-orange/20">
        {/* Title Bar */}
        <div className="bg-white/5 p-4 flex items-center justify-between border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></div>
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60"></div>
            </div>
            <span className="text-[11px] font-mono text-text-secondary uppercase tracking-widest">
              Build: {buildName}
            </span>
          </div>
          <button onClick={onClose}
            className="text-text-secondary hover:text-white text-sm px-3 py-1 bg-white/5 rounded-lg hover:bg-white/10 transition-colors">
            CLOSE
          </button>
        </div>

        {/* Log Output */}
        <div className="flex-1 p-6 font-mono text-[11px] overflow-y-auto bg-black/60 custom-scrollbar">
          {logs.length === 0 ? (
            <div className="text-white/10 italic text-center mt-20 text-lg">
              Waiting for build output...
            </div>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={`whitespace-pre-wrap mb-0.5 border-l-2 pl-3 ${
                line.startsWith('▶') ? 'border-brand-orange/40 text-brand-orange/80' :
                line.startsWith('ERROR') || line.includes('error') ? 'border-red-500/40 text-red-400' :
                line.startsWith('━━━') ? 'border-brand-lime/40 text-brand-lime font-bold' :
                'border-white/5 text-white/70'
              }`}>
                {line}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
