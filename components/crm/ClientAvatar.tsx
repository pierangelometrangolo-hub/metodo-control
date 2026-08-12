import { clientInitials } from "@/lib/crm";

type ClientAvatarProps = {
  businessName: string;
  size?: number;
};

export function ClientAvatar({ businessName, size = 40 }: ClientAvatarProps) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-teal text-[13px] font-semibold text-white"
      style={{ width: size, height: size }}
    >
      {clientInitials(businessName)}
    </span>
  );
}
