import { TextButton } from '@thockdown/interaction/TextButton'
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
import { ABOUT_LINKS, APP_VERSION, CREDITS } from './about'

function openLink(url: string): void {
  void window.thockdownExport?.openExternalUrl(url)
}

/**
 * Options > Advanced > About (`about.ts`). A page that is read rather than
 * operated, so it names things in words, like the Visualizer: the version,
 * then one text button per link, then the credits, each opening its source.
 */
export function AboutOptions() {
  return (
    <>
      <div className="options-curve-rows" role="group" aria-label="About Thockdown Notes">
        <div className="options-curve-row options-about-version-row">
          <span className="options-curve-cell options-curve-display">Thockdown Notes {APP_VERSION}</span>
        </div>
        <div className="options-curve-row options-about-links-row">
          {ABOUT_LINKS.map((link) => (
            <TextButton key={link.url} data-tooltip={link.intention} aria-label={link.intention} onClick={() => openLink(link.url)}>
              {link.label}
            </TextButton>
          ))}
        </div>
      </div>
      <OptionsSubsectionLabel>Attributions</OptionsSubsectionLabel>
      <div className="options-curve-rows" role="list" aria-label="Attributions">
        {CREDITS.map((credit) => (
          <div key={credit.label} className="options-curve-row options-about-credit-row" role="listitem">
            <TextButton data-tooltip={credit.usedFor} aria-label={`${credit.label}: ${credit.usedFor}`} onClick={() => openLink(credit.url)}>
              {credit.label}
            </TextButton>
          </div>
        ))}
      </div>
    </>
  )
}
