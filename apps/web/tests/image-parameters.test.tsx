import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { ParametersFields } from '../src/features/creation/ParametersFields';
import { CanvasSpecs } from '../src/features/creation/CanvasSpecs';
import { defaults } from '../src/features/creation/api';

it('selects a GPT Image model, portrait size, and quality independently from Ark', async () => {
  const square = { ratio: '1:1', resolution: '1K', width: 1024, height: 1024 };
  const portrait = { ratio: '3:4', resolution: '1.5K', width: 1152, height: 1536 };
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      model: 'seedream-5.5',
      max_outputs: 6,
      sizes: [square],
      models: [
        { provider: 'ark', model: 'seedream-5.5', label: 'Seedream 5.5', qualities: [], sizes: [square] },
        { provider: 'gpt-image', model: 'gpt-image-2', label: 'gpt-image-2',
          qualities: ['low', 'medium'], default_quality: 'low', sizes: [square, portrait] },
        { provider: 'gpt-image', model: 'gpt-image-2.6', label: 'gpt-image-2.6',
          qualities: ['low', 'high'], default_quality: 'low', sizes: [square, portrait] },
      ],
    }),
  );
  function Form() {
    const [value, setValue] = useState(defaults);
    return (
      <>
        <ParametersFields value={value} onChange={setValue} />
        <CanvasSpecs parameters={value}>{null}</CanvasSpecs>
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  try {
    render(<Form />);
    fireEvent.change(await screen.findByLabelText('供应商'), { target: { value: 'gpt-image' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'gpt-image-2.6' } });
    fireEvent.change(screen.getByLabelText('比例 / 清晰度'), { target: { value: '3:4/1.5K' } });
    fireEvent.change(screen.getByLabelText('质量'), { target: { value: 'high' } });
    expect(screen.getByText(/图片参数/).parentElement).toHaveTextContent('gpt-image-2.6');
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toMatchObject({
      provider: 'gpt-image', model: 'gpt-image-2.6', ratio: '3:4', resolution: '1.5K',
      quality: 'high', count: 1,
    });
    fireEvent.change(screen.getByLabelText('供应商'), { target: { value: 'ark' } });
    expect(screen.queryByLabelText('质量')).not.toBeInTheDocument();
    expect(JSON.parse(screen.getByRole('status').textContent ?? '')).toMatchObject({
      provider: 'ark', model: 'seedream-5.5', ratio: '1:1', resolution: '1K', quality: null,
    });
  } finally {
    fetch.mockRestore();
  }
});
