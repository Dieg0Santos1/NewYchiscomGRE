import type { ReactNode } from 'react';

type FormFieldProps = {
  label: string;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
};

export function FormField({ label, required, children, wide }: FormFieldProps) {
  return (
    <label className={wide ? 'form-field form-field-wide' : 'form-field'}>
      <span>
        {label}
        {required && <strong> (*)</strong>}
      </span>
      {children}
    </label>
  );
}
