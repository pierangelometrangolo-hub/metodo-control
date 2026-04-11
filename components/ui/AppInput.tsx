type AppInputProps = {
  placeholder?: string;
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  className?: string;
};

export function AppInput({
  placeholder = "",
  value,
  onChange,
  type = "text",
  className = "",
}: AppInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`h-11 w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8b8f94] focus:border-[#017A92] focus:bg-white ${className}`}
    />
  );
}