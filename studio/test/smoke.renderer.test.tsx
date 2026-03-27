import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

describe('vitest renderer smoke tests', () => {
  it('vitest is working', () => {
    expect(1 + 1).toBe(2)
  })

  it('React renders in test environment', () => {
    render(<div>Hello, World!</div>)
    expect(screen.getByText('Hello, World!')).toBeInTheDocument()
  })

  it('async tests work', async () => {
    const result = await Promise.resolve(42)
    expect(result).toBe(42)
  })
})
