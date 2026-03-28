import React from 'react'

export interface ButtonProps {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}

export const Button: React.FC<ButtonProps> = ({ children, onClick, className = '' }) => {
  const baseStyles = 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors'
  
  return (
    <button 
      className={`${baseStyles} ${className}`.trim()} 
      onClick={onClick}
    >
      {children}
    </button>
  )
}
