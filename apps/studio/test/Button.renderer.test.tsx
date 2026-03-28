import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { Button } from '@/components/test-components'

describe('Button Component', () => {
  it('renders without errors', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('accepts text prop', () => {
    render(<Button>Test Button</Button>)
    expect(screen.getByText('Test Button')).toBeInTheDocument()
  })

  it('accepts onClick prop and fires handler', () => {
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)
    
    const button = screen.getByText('Click me')
    fireEvent.click(button)
    
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('has basic styling attributes', () => {
    render(<Button>Styled Button</Button>)
    const button = screen.getByText('Styled Button')
    
    // Check that the button element exists and has className (indicating styled)
    expect(button).toBeInTheDocument()
    expect(button.tagName).toBe('BUTTON')
    expect(button.className).toBeTruthy()
  })

  it('renders as a button element', () => {
    render(<Button>Button Element</Button>)
    const button = screen.getByRole('button', { name: 'Button Element' })
    expect(button).toBeInTheDocument()
  })
})
