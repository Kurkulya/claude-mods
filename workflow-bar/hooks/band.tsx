import type { BoxProps, ElementConstructor, LinkProps, SvgProps, TextProps } from 'claude-code'

import { BAR_HEIGHT, barSvg, cellsToPx } from './svg'
import { mrReserve, summary, terminalRuns } from './view'
import type { MrPart } from './phase'
import type { BarView } from './view'

// Between the bar and the MR beside it: Desktop's Box column gap (cells), the terminal's spaces.
const DESKTOP_MR_GAP = 1
const TERMINAL_MR_GAP = '  '

// The elements of the surface's table the band draws with (the hooks module resolves them).
type TextElements = {
  Box: ElementConstructor<BoxProps>
  Link: ElementConstructor<LinkProps>
  Text: ElementConstructor<TextProps>
}
type DesktopElements = TextElements & { Svg: ElementConstructor<SvgProps> }

// What the band draws: the view, the band's width in cells, and the tickets that pop in this drawing.
type Band = { view: BarView; bodyColumns: number; popped: readonly string[] }

// The MR beside the bar: a Link when its URL passed the checks, else the same words as plain text.
function mrElement({ Link, Text }: TextElements, mr: MrPart) {
  return <Text key="mr">{mr.href ? <Link href={mr.href} label={mr.text} /> : mr.text}</Text>
}

// Desktop: one interactive Svg, with the MR beside it.
export function desktopBand(elements: DesktopElements, { view, bodyColumns, popped }: Band) {
  const { Box, Svg } = elements
  // The MR sits beside the Svg: its cells and the Box's column gap come off the Svg's width.
  const width = cellsToPx(Math.max(1, bodyColumns - mrReserve(view, DESKTOP_MR_GAP)))
  const source = barSvg(view, width, new Set(popped))
  const svg = <Svg source={source} alt={summary(view)} width={width} height={BAR_HEIGHT} isInteractive />

  if (!view.mr) {
    return svg
  }

  return (
    <Box flexDirection="row" columnGap={DESKTOP_MR_GAP}>
      {svg}
      {mrElement(elements, view.mr)}
    </Box>
  )
}

// The terminal: coloured Text runs, then the MR after two spaces.
export function terminalBand(elements: TextElements, { view, bodyColumns }: Band) {
  const { Box, Text } = elements
  const beside = view.mr
  const runs = terminalRuns(view, bodyColumns - mrReserve(view, TERMINAL_MR_GAP.length))

  return (
    <Box>
      {runs.map((run, index) => (
        <Text key={`run-${index}`} color={run.color} backgroundColor={run.backgroundColor}>
          {run.text}
        </Text>
      ))}
      {beside ? <Text key="mr-gap">{TERMINAL_MR_GAP}</Text> : null}
      {beside ? mrElement(elements, beside) : null}
    </Box>
  )
}
