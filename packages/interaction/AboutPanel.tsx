import { OptionsSubsectionLabel } from './OptionsSubsectionLabel'
import { TextButton } from './TextButton'

/** A link on the About page: the words on its button, what pressing it does (the tooltip), and where it goes. */
export interface AboutLink {
  label: string
  intention: string
  url: string
}

/** Third-party work an app redistributes whose license asks for credit: the button's words, what the app uses it for (the tooltip), and its source or license page. */
export interface Credit {
  label: string
  usedFor: string
  url: string
}

/**
 * The About page every app shows (desktop: Options > Advanced > About; phone:
 * the Settings tab). A page that is read rather than operated, so it names
 * things in words: the app and its version, one text button per link, then the
 * credits, each opening its source. What is listed is the app's own, and so is
 * how a link is opened: the desktop hands it to the system through the main
 * process, the phone's WebView hands an outside URL to the system itself.
 */
export function AboutPanel({ appName, version, links, credits, openLink }: {
  appName: string
  version: string
  links: readonly AboutLink[]
  credits: readonly Credit[]
  openLink: (url: string) => void
}) {
  return (
    <>
      <div className="options-curve-rows" role="group" aria-label={`About ${appName}`}>
        <div className="options-curve-row options-about-version-row">
          <span className="options-curve-cell options-curve-display">{appName} {version}</span>
        </div>
        <div className="options-curve-row options-about-links-row">
          {links.map((link) => (
            <TextButton key={link.url} data-tooltip={link.intention} aria-label={link.intention} onClick={() => openLink(link.url)}>
              {link.label}
            </TextButton>
          ))}
        </div>
      </div>
      <OptionsSubsectionLabel>Attributions</OptionsSubsectionLabel>
      <div className="options-curve-rows" role="list" aria-label="Attributions">
        {credits.map((credit) => (
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
