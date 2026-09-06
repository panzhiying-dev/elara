/** 负责把当前 Three.js Canvas 导出为 PNG 文件并触发本地下载。 */
export class PhotoCaptureService {
  /** 将 Canvas 内容转换为 PNG Blob；Canvas 无法导出时抛出可理解的中文错误。 */
  public capture(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
          return
        }
        reject(new Error('当前 Avatar 画面无法生成照片。'))
      }, 'image/png')
    })
  }

  /** 捕获并下载 PNG；Object URL 在浏览器完成下载触发后再释放。 */
  public async captureAndDownload(canvas: HTMLCanvasElement): Promise<void> {
    const blob = await this.capture(canvas)
    downloadBlob(blob, `avatar-photo-${formatTimestamp()}.png`)
  }
}

/** 触发浏览器本地下载，不向后端上传文件。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 生成 YYYYMMDD-HHmmss 文件名时间片段。 */
function formatTimestamp(date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}
