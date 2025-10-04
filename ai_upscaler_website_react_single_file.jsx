import React, { useState, useRef, useEffect } from "react";

// AI Upscaler Website
// Single-file React component (Tailwind CSS assumed globally available)
// Default export a component you can drop into a React app.
// Frontend responsibilities:
// - Allow image or video upload (drag & drop or file select)
// - Preview chosen file
// - Send file to backend endpoints for upscaling (/api/upscale-image or /api/upscale-video)
// - Show upload & processing progress, show result and download link
//
// Backend notes (not included):
// - You'll need a server that accepts the uploads and runs an upscaler model:
//    * For images: Real-ESRGAN, ESRGAN, or a commercial API. Output a 4K (3840x2160) image if possible.
//    * For video: Video upscaling pipelines (e.g., Video2X, waifu2x + ffmpeg, commercial services) that can output 4K.
// - Backend should return a jobId on upload and expose a status endpoint (/api/status/:jobId) that returns progress and finalUrl when ready.
// - For large files, implement chunked uploads or direct-to-cloud (S3 presigned) uploads.

export default function AIUpscalerApp() {
  const [file, setFile] = useState(null);
  const [fileType, setFileType] = useState(null); // 'image' | 'video' | null
  const [previewUrl, setPreviewUrl] = useState(null);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);
  const POLL_INTERVAL = 3000; // ms
  const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB (adjust as needed)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    let timer = null;
    if (jobId && isProcessing) {
      // Polling status endpoint
      const poll = async () => {
        try {
          const res = await fetch(`/api/status/${jobId}`);
          if (!res.ok) throw new Error("Status fetch failed");
          const data = await res.json();
          // Expected data example: { status: 'processing'|'done'|'failed', progress: 42, resultUrl: '...' }
          setProcessingProgress(data.progress ?? null);
          if (data.status === "done") {
            setResultUrl(data.resultUrl);
            setIsProcessing(false);
            setJobId(null);
          } else if (data.status === "failed") {
            setMessage(data.error || "Processing failed on server");
            setIsProcessing(false);
            setJobId(null);
          } else {
            timer = setTimeout(poll, POLL_INTERVAL);
          }
        } catch (err) {
          console.error(err);
          setMessage("Could not fetch job status. Trying again...");
          timer = setTimeout(poll, POLL_INTERVAL);
        }
      };
      poll();
    }
    return () => clearTimeout(timer);
  }, [jobId, isProcessing]);

  const onFiles = (files) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (f.size > MAX_FILE_SIZE_BYTES) {
      setMessage("File too large. Please upload a smaller file or use chunked/direct upload.");
      return;
    }
    setFile(f);
    const type = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : null;
    setFileType(type);
    setMessage("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    setResultUrl(null);
    setProcessingProgress(null);
    setUploadProgress(0);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    onFiles(dt.files);
  };

  const handleFileChange = (e) => onFiles(e.target.files);

  // Use XMLHttpRequest to get upload progress events
  const uploadFile = (url, formData, onProgress) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText);
            resolve(resp);
          } catch (err) {
            resolve({});
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            onProgress(pct);
          }
        };
      }
      xhr.send(formData);
    });
  };

  const startUpscale = async () => {
    if (!file) return setMessage("Koi file select karo.");
    setMessage("");
    setUploadProgress(0);
    setProcessingProgress(null);
    setResultUrl(null);

    const endpoint = fileType === "image" ? "/api/upscale-image" : "/api/upscale-video";
    const fd = new FormData();
    fd.append("file", file);
    // Additional optional settings
    fd.append("target_resolution", "3840x2160");
    fd.append("scale", "4x");
    fd.append("preserve_audio", "true");

    try {
      setIsProcessing(true);
      const response = await uploadFile(endpoint, fd, (pct) => setUploadProgress(pct));
      // Expected upload response: { jobId: 'abc123' }
      if (response.jobId) {
        setJobId(response.jobId);
        setMessage("File uploaded. Processing started...");
      } else if (response.resultUrl) {
        // If backend processed synchronously and returned result immediately
        setResultUrl(response.resultUrl);
        setIsProcessing(false);
      } else {
        setMessage("Unexpected server response. Check backend logs.");
        setIsProcessing(false);
      }
    } catch (err) {
      console.error(err);
      setMessage("Upload failed: " + err.message);
      setIsProcessing(false);
    }
  };

  const clearAll = () => {
    setFile(null);
    setFileType(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setMessage("");
    setUploadProgress(0);
    setProcessingProgress(null);
    setResultUrl(null);
    setJobId(null);
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-2">AI Upscaler — Image & Video to 4K</h1>
        <p className="text-sm text-gray-600 mb-4">Upload a low-quality photo or video and upscale it to 4K using your backend AI upscaler.</p>

        <div
          ref={dropRef}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center mb-4 hover:border-gray-300"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {!file && (
            <div>
              <p className="mb-3">Drag & drop image/video here, or</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md"
              >
                File select karo
              </button>
              <p className="text-xs text-gray-500 mt-2">Max recommended size: 1 GB. For larger files use chunked or direct uploads.</p>
            </div>
          )}

          {file && (
            <div className="flex flex-col md:flex-row items-center gap-4">
              <div className="w-full md:w-1/2">
                {fileType === "image" && <img src={previewUrl} alt="preview" className="max-h-64 mx-auto rounded-md" />}
                {fileType === "video" && (
                  <video controls src={previewUrl} className="max-h-64 mx-auto rounded-md" />
                )}
              </div>
              <div className="w-full md:w-1/2 text-left">
                <p className="font-medium">{file.name}</p>
                <p className="text-sm text-gray-500">Type: {file.type || "unknown"}</p>
                <p className="text-sm text-gray-500">Size: {(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={startUpscale} className="px-4 py-2 bg-green-600 text-white rounded-md" disabled={isProcessing}>
                    {isProcessing ? "Processing..." : "4K me karo"}
                  </button>
                  <button onClick={clearAll} className="px-4 py-2 bg-gray-200 rounded-md">
                    Clear
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Progress & messages */}
        <div className="mb-4">
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="mb-2">
              <p className="text-sm">Upload: {uploadProgress}%</p>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div style={{ width: `${uploadProgress}%` }} className="h-2 rounded-full" />
              </div>
            </div>
          )}

          {processingProgress !== null && (
            <div className="mb-2">
              <p className="text-sm">Processing: {processingProgress}%</p>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div style={{ width: `${processingProgress}%` }} className="h-2 rounded-full" />
              </div>
            </div>
          )}

          {message && <p className="text-sm text-red-600">{message}</p>}
        </div>

        {/* Result */}
        {resultUrl && (
          <div className="mt-4 border-t pt-4">
            <h2 className="text-lg font-semibold mb-2">Result ready</h2>
            {fileType === "image" && <img src={resultUrl} alt="result" className="max-w-full rounded-md" />}
            {fileType === "video" && (
              <video controls src={resultUrl} className="max-w-full rounded-md" />
            )}
            <div className="mt-3 flex gap-2">
              <a href={resultUrl} download className="px-4 py-2 bg-blue-600 text-white rounded-md">Download</a>
              <button onClick={() => navigator.clipboard?.writeText(resultUrl)} className="px-4 py-2 bg-gray-200 rounded-md">Copy link</button>
            </div>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          <p>Notes:</p>
          <ul className="list-disc ml-5">
            <li>Yeh frontend backend ke bina kaam nahi karega — backend me upscaling model chahiye.</li>
            <li>Large video files ke liye chunked uploads ya cloud direct-upload (S3) recommend kiya jata hai.</li>
            <li>Privacy: Uploaded files server pe store ho sakte hain; production me retention policies aur encryption lagaen.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
