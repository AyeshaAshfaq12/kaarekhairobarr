import 'server-only'
import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatDateTime } from './time'

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.45, color: '#0f1917' },
  heading: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  subheading: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 4 },
  paragraph: { marginBottom: 3 },
  signature: { marginTop: 24, padding: 12, borderWidth: 1, borderColor: '#cdd9d7' },
  label: { color: '#54706b' },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, fontSize: 8, color: '#768f8a' },
})

function MarkdownLines({ body }: { body: string }) {
  return (
    <>
      {body.split('\n').map((line, index) => {
        if (line.startsWith('# ')) return <Text key={index} style={styles.heading}>{line.slice(2)}</Text>
        if (line.startsWith('## ')) return <Text key={index} style={styles.subheading}>{line.slice(3)}</Text>
        if (!line.trim()) return <Text key={index}> </Text>
        return <Text key={index} style={styles.paragraph}>{line}</Text>
      })}
    </>
  )
}

export async function renderNdaPdf(input: {
  body: string
  version: number
  typedName: string
  signedAt: Date
  ip: string
  bodySha256: string
}) {
  return renderToBuffer(
    <Document title={`KKB NDA v${input.version} — ${input.typedName}`}>
      <Page size="A4" style={styles.page}>
        <MarkdownLines body={input.body} />
        <View style={styles.signature} wrap={false}>
          <Text>
            <Text style={styles.label}>Signed by (typed name): </Text>
            {input.typedName}
          </Text>
          <Text>
            <Text style={styles.label}>Signed at: </Text>
            {formatDateTime(input.signedAt)} (Asia/Karachi)
          </Text>
          <Text>
            <Text style={styles.label}>Agreement version: </Text>v{input.version}
          </Text>
          <Text>
            <Text style={styles.label}>IP address: </Text>
            {input.ip}
          </Text>
          <Text>
            <Text style={styles.label}>Document SHA-256: </Text>
            {input.bodySha256}
          </Text>
        </View>
        <Text style={styles.footer} fixed>
          Kaare Khair o Barr — Member Confidentiality and Conduct Agreement
        </Text>
      </Page>
    </Document>
  )
}
