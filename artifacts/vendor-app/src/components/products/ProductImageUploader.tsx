import { CARD, LABEL } from "../../lib/ui";

interface ProductImageUploaderProps {
  videoUrl: string;
  onVideoChange: (url: string) => void;
  videoUploading: boolean;
  onVideoUpload: (file: File) => void;
  allowedVideoFormats: string[];
  maxVideoMb: number;
  maxVideoDurationSec: number;
  uploadFormatLabels: string[];
}

export function ProductImageUploader({
  videoUrl,
  onVideoChange,
  videoUploading,
  onVideoUpload,
  allowedVideoFormats,
  maxVideoMb,
  maxVideoDurationSec,
  uploadFormatLabels,
}: ProductImageUploaderProps) {
  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <label className={LABEL}>Upload Video (optional, ≤{maxVideoDurationSec}s)</label>

      {videoUrl ? (
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video
              src={videoUrl}
              className="w-full h-full object-contain"
              controls
              muted
              playsInline
            />
          </div>
          <div className="flex gap-2">
            <label className="flex-1 h-9 bg-orange-50 text-orange-600 font-bold rounded-xl text-sm flex items-center justify-center gap-1.5 cursor-pointer android-press">
              <span>🔄 Replace</span>
              <input
                type="file"
                accept={allowedVideoFormats.join(",")}
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) onVideoUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              onClick={() => onVideoChange("")}
              className="flex-1 h-9 bg-red-50 text-red-500 font-bold rounded-xl text-sm android-press"
            >
              🗑️ Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            videoUploading
              ? "border-orange-300 bg-orange-50"
              : "border-gray-200 hover:border-orange-300 hover:bg-orange-50/50"
          }`}
        >
          {videoUploading ? (
            <>
              <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-semibold text-orange-600">Uploading video...</span>
            </>
          ) : (
            <>
              <span className="text-2xl">🎬</span>
              <span className="text-sm font-semibold text-gray-600">
                Tap to upload a product video
              </span>
              <span className="text-xs text-gray-400">
                {uploadFormatLabels.map(fmt => fmt.toUpperCase()).join(", ")} · Max {maxVideoMb}MB
                · ≤{maxVideoDurationSec}s
              </span>
            </>
          )}
          <input
            type="file"
            accept={allowedVideoFormats.join(",")}
            className="hidden"
            disabled={videoUploading}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onVideoUpload(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}
