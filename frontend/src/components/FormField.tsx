import type { ReactNode } from 'react';

type FormFieldProps = {
  label: string;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
  className?: string;
};

export function FormField({ label, required, children, wide, className }: FormFieldProps) {
  const classes = ['form-field'];
  if (wide) classes.push('form-field-wide');
  if (className) classes.push(className);

  return (
    <label className={classes.join(' ')}>
      <span>
        {label}
        {required && <strong> (*)</strong>}
      </span>
      {children}
    </label>
  );
}
