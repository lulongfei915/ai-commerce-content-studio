import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { App } from '../src/app/App';

test('renders the studio shell for the production workspace', () => {
  render(<App />);

  expect(screen.getByText('造物 Studio')).toBeInTheDocument();
  expect(screen.getByText('准备开始创作')).toBeInTheDocument();
});
