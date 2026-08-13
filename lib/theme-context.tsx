'use client'
import { createContext, useContext, useState, useEffect } from 'react'
type Theme = 'ibm-fitness' | 'ibm-dark' | 'apex' | 'carbon' | 'kings' | 'sand' | 'hotpink' | 'camo' | 'hotgirlsummer' | 'sunsetcoast' | 'foresttrail' | 'moltencarbon' | 'pastelpop'
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'ibm-fitness', setTheme: () => {} })
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('ibm-fitness')
  useEffect(() => {
    const saved = localStorage.getItem('mb-theme') as Theme
    if (saved) setThemeState(saved)
  }, [])
  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem('mb-theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}
export const useTheme = () => useContext(ThemeContext)
