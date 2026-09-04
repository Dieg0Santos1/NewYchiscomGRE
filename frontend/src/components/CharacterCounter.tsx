type CharacterCounterProps = {
  current: number;
  maximum: number;
};

export function CharacterCounter({ current, maximum }: CharacterCounterProps) {
  const remaining = Math.max(0, maximum - current);

  return (
    <small className={remaining === 0 ? 'character-counter limit-reached' : 'character-counter'}>
      {remaining}/{maximum} caracteres disponibles
    </small>
  );
}
