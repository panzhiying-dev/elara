import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

const sourceDirectory = '/Users/panzhiying/Desktop/fbx2vrma-converter/vrma'
const targetDirectory = join(process.cwd(), 'src', 'vrma')

/** 计算资源内容哈希，用于识别同内容的重复动作。 */
function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** 为同名但内容不同的资源分配不覆盖现有文件的新文件名。 */
function getAvailableTarget(sourcePath) {
  const originalName = basename(sourcePath)
  const extension = extname(originalName)
  const stem = originalName.slice(0, -extension.length)
  let targetPath = join(targetDirectory, originalName)
  let index = 1
  while (existsSync(targetPath)) {
    targetPath = join(targetDirectory, `${stem}-external-${index}${extension}`)
    index += 1
  }
  return targetPath
}

if (!existsSync(sourceDirectory)) {
  console.error(`VRMA source directory does not exist: ${sourceDirectory}`)
  process.exitCode = 1
} else {
  mkdirSync(targetDirectory, { recursive: true })
  const targetHashes = new Set(
    readdirSync(targetDirectory)
      .filter((name) => name.toLowerCase().endsWith('.vrma'))
      .map((name) => hashFile(join(targetDirectory, name))),
  )
  for (const name of readdirSync(sourceDirectory).filter((value) => value.toLowerCase().endsWith('.vrma'))) {
    const sourcePath = join(sourceDirectory, name)
    const sourceHash = hashFile(sourcePath)
    if (targetHashes.has(sourceHash)) {
      console.info(`skip duplicate: ${name}`)
      continue
    }
    const targetPath = existsSync(join(targetDirectory, name))
      ? getAvailableTarget(sourcePath)
      : join(targetDirectory, name)
    copyFileSync(sourcePath, targetPath)
    targetHashes.add(sourceHash)
    console.info(`synced: ${name} -> ${basename(targetPath)}`)
  }
}
