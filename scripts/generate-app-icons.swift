import CoreGraphics
import Foundation
import ImageIO

guard CommandLine.arguments.count == 2 else {
    fputs("usage: generate-app-icons.swift <source.icns>\n", stderr)
    exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil)
guard let source, let logo = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("could not read source icon\n", stderr)
    exit(1)
}

let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: size * 4,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fputs("could not create drawing context\n", stderr)
    exit(1)
}

context.clear(CGRect(x: 0, y: 0, width: size, height: size))
context.setFillColor(CGColor.white)
context.addPath(CGPath(roundedRect: CGRect(x: 72, y: 72, width: 880, height: 880), cornerWidth: 190, cornerHeight: 190, transform: nil))
context.fillPath()

context.interpolationQuality = .high
context.draw(logo, in: CGRect(x: 171, y: 171, width: 682, height: 682))

guard let output = context.makeImage() else {
    fputs("could not create output image\n", stderr)
    exit(1)
}

let destinationURL = sourceURL.deletingPathExtension().appendingPathExtension("png")
guard let destination = CGImageDestinationCreateWithURL(destinationURL as CFURL, "public.png" as CFString, 1, nil) else {
    fputs("could not create output file\n", stderr)
    exit(1)
}
CGImageDestinationAddImage(destination, output, nil)
guard CGImageDestinationFinalize(destination) else {
    fputs("could not write output file\n", stderr)
    exit(1)
}
