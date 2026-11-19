import Image from "next/image";

interface StoreDownloadButtonsProps {
  id?: string;
  prelaunch?: boolean;
}

export default function StoreDownloadButtons({
  id,
  prelaunch = false,
}: StoreDownloadButtonsProps) {
  return (
    <div id={id} className="mt-7">
      {prelaunch && (
        <p className="mb-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Coming soon on iPhone and Android
        </p>
      )}

      <div className="flex w-full max-w-[340px] items-center gap-3">
        <div className="min-w-0 flex-1">
          <Image
            src="/store-badges/Download_on_the_App_Store_Badge_US-UK_RGB_blk_092917.svg"
            alt="Download on the App Store"
            width={160}
            height={48}
            className="block h-auto w-full"
          />
        </div>

        <div className="min-w-0 flex-1">
          <Image
            src="/store-badges/GetItOnGooglePlay_Badge_Web_color_English.svg"
            alt="Get it on Google Play"
            width={160}
            height={48}
            className="block h-auto w-full"
          />
        </div>
      </div>
    </div>
  );
}