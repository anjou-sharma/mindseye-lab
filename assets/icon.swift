import AppKit
let N=1024.0
let cs=CGColorSpaceCreateDeviceRGB()
func C(_ r:Double,_ g:Double,_ b:Double,_ a:Double=1)->CGColor{CGColor(red:r,green:g,blue:b,alpha:a)}
let INK=C(0.078,0.067,0.165), GOLD=C(0.93,0.81,0.47), VIO=C(0.68,0.60,1.0), PALE=C(0.93,0.91,1.0)
func rad(_ d:Double)->Double{ d*Double.pi/180 }
let c=CGContext(data:nil,width:Int(N),height:Int(N),bitsPerComponent:8,bytesPerRow:0,space:cs,bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue)!
let g=CGGradient(colorsSpace:cs,colors:[C(0.173,0.141,0.376),C(0.063,0.055,0.137)] as CFArray,locations:[0,1])!
c.drawLinearGradient(g,start:CGPoint(x:0,y:N),end:CGPoint(x:N,y:0),options:[])

let cx=512.0, cy=470.0          // nudged down so the wreath reads centred in the square
let R=286.0

// stem arcs first, behind the leaves
c.setStrokeColor(GOLD); c.setLineWidth(13); c.setLineCap(.round)
c.addArc(center:CGPoint(x:cx,y:cy),radius:R,startAngle:rad(128),endAngle:rad(258),clockwise:false); c.strokePath()
c.addArc(center:CGPoint(x:cx,y:cy),radius:R,startAngle:rad(282),endAngle:rad(52),clockwise:false);  c.strokePath()

func leaf(_ aDeg:Double,_ lean:Double,_ L:Double,_ W:Double){
  c.saveGState()
  c.translateBy(x:cx+cos(rad(aDeg))*R, y:cy+sin(rad(aDeg))*R)
  c.rotate(by: rad(aDeg)+lean)
  let p=CGMutablePath()
  p.move(to:CGPoint(x:-6,y:0))
  p.addQuadCurve(to:CGPoint(x:L,y:0),control:CGPoint(x:L*0.42,y:W))
  p.addQuadCurve(to:CGPoint(x:-6,y:0),control:CGPoint(x:L*0.42,y:-W*0.34))
  c.addPath(p); c.setFillColor(GOLD); c.fillPath()
  c.restoreGState()
}
let n=10
for k in 0..<n {
  let t=Double(k)/Double(n-1)
  let L=74.0 + (1.0-t)*16.0     // slightly longer leaves near the open top
  // leaves lie along the wreath (~62 deg off radial) and sweep up toward the opening
  leaf(130.0 + t*126.0, -rad(58), L, 25)    // left arm  130 -> 256
  leaf(50.0  - t*126.0,  rad(58), L, 25)    // right arm  50 -> -76
}

// tie at the foot of the wreath
c.setStrokeColor(GOLD); c.setLineWidth(13); c.setLineCap(.round)
let tie=CGMutablePath()
tie.move(to:CGPoint(x:cx-30,y:cy-R-6)); tie.addQuadCurve(to:CGPoint(x:cx+30,y:cy-R-6),control:CGPoint(x:cx,y:cy-R+22))
tie.move(to:CGPoint(x:cx-30,y:cy-R+10)); tie.addQuadCurve(to:CGPoint(x:cx+30,y:cy-R+10),control:CGPoint(x:cx,y:cy-R-18))
c.addPath(tie); c.strokePath()

// the eye, centred in the wreath
c.setStrokeColor(PALE); c.setLineWidth(27); c.setLineJoin(.round); c.setLineCap(.round)
let e=CGMutablePath()
e.move(to:CGPoint(x:cx-172,y:cy+28))
e.addQuadCurve(to:CGPoint(x:cx+172,y:cy+28),control:CGPoint(x:cx,y:cy+196))
e.addQuadCurve(to:CGPoint(x:cx-172,y:cy+28),control:CGPoint(x:cx,y:cy-140))
c.addPath(e); c.strokePath()
c.setFillColor(VIO); c.fillEllipse(in:CGRect(x:cx-57,y:cy+28-57,width:114,height:114))
c.setFillColor(INK); c.fillEllipse(in:CGRect(x:cx-23,y:cy+28-23,width:46,height:46))

let u=URL(fileURLWithPath:CommandLine.arguments[1]+"/logo-laurel.png")
let d=CGImageDestinationCreateWithURL(u as CFURL,"public.png" as CFString,1,nil)!
CGImageDestinationAddImage(d,c.makeImage()!,nil); CGImageDestinationFinalize(d)
print("wrote laurel v3")
