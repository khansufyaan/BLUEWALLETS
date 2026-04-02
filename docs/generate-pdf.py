#!/usr/bin/env python3
"""
Generate Blue Wallets Deployment Guide PDF
Professional dark-navy institutional style
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch, mm
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable, Image
)
from reportlab.platypus.flowables import Flowable
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import os

# ── Brand Colors ──────────────────────────────────────────────
NAVY_DARK = HexColor('#060A14')
NAVY = HexColor('#0B1120')
NAVY_LIGHT = HexColor('#111B2E')
BLUE_700 = HexColor('#1D4ED8')
BLUE_600 = HexColor('#2563EB')
BLUE_500 = HexColor('#3B82F6')
BLUE_400 = HexColor('#60A5FA')
SLATE_300 = HexColor('#CBD5E1')
SLATE_400 = HexColor('#94A3B8')
SLATE_500 = HexColor('#64748B')
WHITE = HexColor('#EEF2FF')
EMERALD = HexColor('#10B981')
RED = HexColor('#EF4444')
AMBER = HexColor('#F59E0B')
BORDER = HexColor('#1E293B')

OUTPUT = os.path.join(os.path.dirname(__file__), 'Blue-Wallets-Deployment-Guide.pdf')

# ── Custom Flowables ──────────────────────────────────────────

class BlueLogo(Flowable):
    """Draw the Blue Wallets stacked-cards logo"""
    def __init__(self, size=40):
        Flowable.__init__(self)
        self.size = size
        self.width = size
        self.height = size

    def draw(self):
        c = self.canv
        s = self.size
        r = s * 0.12  # corner radius
        w = s * 0.75  # rect width
        h = s * 0.31  # rect height
        x0 = (s - w) / 2
        colors = [BLUE_700, BLUE_600, BLUE_400]
        for i, color in enumerate(colors):
            y = s - (i + 1) * (h * 0.88)
            c.setFillColor(color)
            c.roundRect(x0, y, w, h, r, fill=1, stroke=0)


class DarkBox(Flowable):
    """Dark elevated box with content"""
    def __init__(self, content, width=None, bg=NAVY_LIGHT, border_color=BORDER, padding=12):
        Flowable.__init__(self)
        self.content = content
        self.bg = bg
        self.border_color = border_color
        self.padding = padding
        self._width = width or 6.5 * inch

    def wrap(self, availWidth, availHeight):
        self.width = min(self._width, availWidth)
        self.height = self.padding * 2 + 14 * len(self.content.split('\n'))
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.setStrokeColor(self.border_color)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=1)
        c.setFillColor(BLUE_400)
        c.setFont('Courier', 10)
        lines = self.content.split('\n')
        for i, line in enumerate(lines):
            c.drawString(self.padding, self.height - self.padding - 12 - i * 14, line)


class SectionDivider(Flowable):
    """Thin blue accent line"""
    def __init__(self, width=6.5*inch):
        Flowable.__init__(self)
        self._width = width

    def wrap(self, availWidth, availHeight):
        return min(self._width, availWidth), 2

    def draw(self):
        self.canv.setStrokeColor(BLUE_600)
        self.canv.setLineWidth(1.5)
        self.canv.line(0, 1, self.width, 1)


# ── Page Templates ────────────────────────────────────────────

def cover_page(canvas_obj, doc):
    """Dark navy cover page"""
    c = canvas_obj
    w, h = letter

    # Background
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, w, h, fill=1, stroke=0)

    # Blue accent bar at top
    c.setFillColor(BLUE_600)
    c.rect(0, h - 4, w, 4, fill=1, stroke=0)

    # Logo
    logo_size = 60
    logo_x = (w - logo_size) / 2
    logo_y = h - 200
    colors = [BLUE_700, BLUE_600, BLUE_400]
    rw = logo_size * 0.75
    rh = logo_size * 0.31
    rx = logo_x + (logo_size - rw) / 2
    for i, color in enumerate(colors):
        ry = logo_y + logo_size - (i + 1) * (rh * 0.88)
        c.setFillColor(color)
        c.roundRect(rx, ry, rw, rh, logo_size * 0.12, fill=1, stroke=0)

    # Title
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 32)
    c.drawCentredString(w/2, h - 280, 'Blue Wallets')

    c.setFillColor(BLUE_400)
    c.setFont('Helvetica', 14)
    c.drawCentredString(w/2, h - 310, 'On-Premises Deployment Guide')

    # Subtitle
    c.setFillColor(SLATE_400)
    c.setFont('Helvetica', 11)
    c.drawCentredString(w/2, h - 350, 'For Bank Infrastructure & Security Teams')
    c.drawCentredString(w/2, h - 368, 'Version 1.0  |  April 2026')

    # Tagline box
    box_w = 400
    box_h = 50
    box_x = (w - box_w) / 2
    box_y = h - 450
    c.setFillColor(NAVY_LIGHT)
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.roundRect(box_x, box_y, box_w, box_h, 8, fill=1, stroke=1)
    c.setFillColor(SLATE_300)
    c.setFont('Helvetica', 10)
    c.drawCentredString(w/2, box_y + 30, 'The World\'s First Fully On-Premises')
    c.drawCentredString(w/2, box_y + 14, 'Wallet-as-a-Service for Regulated Financial Institutions')

    # Footer badges
    badges = ['FIPS 140-3 Level 3', 'PKCS#11', 'Luna HSM', 'mTLS', 'Docker']
    badge_y = 80
    total_w = sum(len(b) * 6 + 20 for b in badges) + 8 * (len(badges) - 1)
    bx = (w - total_w) / 2
    for badge in badges:
        bw = len(badge) * 6 + 20
        c.setFillColor(HexColor('#0E1628'))
        c.setStrokeColor(HexColor('#1E3A5F'))
        c.setLineWidth(0.5)
        c.roundRect(bx, badge_y, bw, 22, 4, fill=1, stroke=1)
        c.setFillColor(BLUE_400)
        c.setFont('Helvetica', 8)
        c.drawCentredString(bx + bw/2, badge_y + 7, badge)
        bx += bw + 8

    # Bottom line
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(72, 60, w - 72, 60)
    c.setFillColor(SLATE_500)
    c.setFont('Helvetica', 8)
    c.drawCentredString(w/2, 45, 'CONFIDENTIAL  |  Blue Wallets Ltd.')


def page_template(canvas_obj, doc):
    """Standard page with dark background and header/footer"""
    c = canvas_obj
    w, h = letter

    # Background
    c.setFillColor(NAVY_DARK)
    c.rect(0, 0, w, h, fill=1, stroke=0)

    # Header line
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(54, h - 40, w - 54, h - 40)

    # Header text
    c.setFillColor(SLATE_500)
    c.setFont('Helvetica', 8)
    c.drawString(54, h - 34, 'Blue Wallets')
    c.drawRightString(w - 54, h - 34, 'On-Premises Deployment Guide')

    # Footer
    c.line(54, 40, w - 54, 40)
    c.setFillColor(SLATE_500)
    c.setFont('Helvetica', 8)
    c.drawString(54, 26, 'CONFIDENTIAL')
    c.drawCentredString(w/2, 26, f'Page {doc.page}')
    c.drawRightString(w - 54, 26, 'v1.0 | April 2026')


# ── Styles ────────────────────────────────────────────────────

styles = {
    'h1': ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=22, textColor=WHITE,
                         spaceAfter=6, spaceBefore=24, leading=26),
    'h2': ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=16, textColor=BLUE_400,
                         spaceAfter=8, spaceBefore=20, leading=20),
    'h3': ParagraphStyle('H3', fontName='Helvetica-Bold', fontSize=12, textColor=WHITE,
                         spaceAfter=6, spaceBefore=14, leading=15),
    'body': ParagraphStyle('Body', fontName='Helvetica', fontSize=10, textColor=SLATE_300,
                           spaceAfter=8, leading=15, alignment=TA_JUSTIFY),
    'body_sm': ParagraphStyle('BodySm', fontName='Helvetica', fontSize=9, textColor=SLATE_400,
                              spaceAfter=6, leading=13),
    'code': ParagraphStyle('Code', fontName='Courier', fontSize=9, textColor=BLUE_400,
                           spaceAfter=4, leading=13, leftIndent=12,
                           backColor=NAVY_LIGHT),
    'bullet': ParagraphStyle('Bullet', fontName='Helvetica', fontSize=10, textColor=SLATE_300,
                             spaceAfter=4, leading=14, leftIndent=20, bulletIndent=8),
    'warning': ParagraphStyle('Warning', fontName='Helvetica-Bold', fontSize=10, textColor=AMBER,
                              spaceAfter=6, leading=14),
    'note': ParagraphStyle('Note', fontName='Helvetica', fontSize=9, textColor=EMERALD,
                           spaceAfter=6, leading=13, leftIndent=12),
}


def h1(text): return Paragraph(text, styles['h1'])
def h2(text): return Paragraph(text, styles['h2'])
def h3(text): return Paragraph(text, styles['h3'])
def p(text): return Paragraph(text, styles['body'])
def sm(text): return Paragraph(text, styles['body_sm'])
def code(text): return DarkBox(text)
def bullet(text): return Paragraph(f'<bullet>&bull;</bullet> {text}', styles['bullet'])
def warn(text): return Paragraph(f'&#9888; {text}', styles['warning'])
def note(text): return Paragraph(f'&#10003; {text}', styles['note'])
def sp(h=8): return Spacer(1, h)
def divider(): return SectionDivider()
def pb(): return PageBreak()


# ── Content ───────────────────────────────────────────────────

def build_content():
    story = []

    # Cover page placeholder (handled by page template)
    story.append(Spacer(1, 500))
    story.append(pb())

    # ── TABLE OF CONTENTS ──
    story.append(h1('Table of Contents'))
    story.append(sp(12))
    toc_items = [
        ('1', 'Overview', '3'),
        ('2', 'Prerequisites', '4'),
        ('3', 'Network Architecture', '5'),
        ('4', 'Step 1: Pull Docker Images', '6'),
        ('5', 'Step 2: Generate mTLS Certificates', '7'),
        ('6', 'Step 3: Configure Environment', '8'),
        ('7', 'Step 4: Mount HSM', '9'),
        ('8', 'Step 5: Start Services', '10'),
        ('9', 'Step 6: Key Ceremony', '11'),
        ('10', 'Step 7: Console Setup', '12'),
        ('11', 'Post-Deployment Security Checklist', '13'),
        ('12', 'Default Credentials', '14'),
        ('13', 'Troubleshooting', '15'),
    ]
    for num, title, pg in toc_items:
        story.append(Paragraph(
            f'<font color="#60A5FA">{num}.</font>  {title} <font color="#64748B">{"." * (60 - len(title))} {pg}</font>',
            styles['body']
        ))
    story.append(pb())

    # ── 1. OVERVIEW ──
    story.append(h1('1. Overview'))
    story.append(divider())
    story.append(sp())
    story.append(p(
        'Blue Wallets is the world\'s first fully on-premises Wallet-as-a-Service (WaaS) platform '
        'built for regulated financial institutions. It provides institutional-grade digital asset '
        'custody using FIPS 140-3 Level 3 certified Hardware Security Modules (HSMs), with all '
        'infrastructure running entirely within the bank\'s own data center.'
    ))
    story.append(sp())
    story.append(h2('Two-Tier Architecture'))
    story.append(p(
        'Blue Wallets separates concerns into two isolated tiers, mirroring how banks '
        'already segment critical infrastructure:'
    ))
    story.append(sp(4))
    story.append(bullet('<b><font color="#60A5FA">Blue Driver</font></b> (Secure Zone) &mdash; HSM connector, key management, transaction signing. '
                        'No internet access. Communicates only with the HSM and PostgreSQL database.'))
    story.append(bullet('<b><font color="#60A5FA">Blue Console</font></b> (DMZ) &mdash; Bank-facing API, operations dashboard, blockchain '
                        'connectivity, compliance screening. Has internet access for RPC nodes and vendor APIs.'))
    story.append(sp())
    story.append(p(
        'The two tiers communicate over a dedicated internal network secured by mutual TLS (mTLS). '
        'The Driver\'s internal API (port 3200) requires the Console to present a valid client '
        'certificate signed by your internal CA. Connections without valid certificates are rejected.'
    ))
    story.append(sp())
    story.append(h2('Docker Containers'))
    story.append(p('The platform ships as three Docker containers:'))
    story.append(sp(4))

    container_data = [
        ['Container', 'Image', 'Purpose', 'Network'],
        ['postgres', 'postgres:16-alpine', 'Persistent storage (8 tables)', 'internal'],
        ['blue-driver', 'ghcr.io/.../blue-driver', 'HSM connector + signing', 'internal'],
        ['blue-console', 'ghcr.io/.../blue-console', 'Bank API + ops dashboard', 'internal + internet'],
    ]
    t = Table(container_data, colWidths=[1.2*inch, 1.8*inch, 1.8*inch, 1.2*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(pb())

    # ── 2. PREREQUISITES ──
    story.append(h1('2. Prerequisites'))
    story.append(divider())
    story.append(sp())
    story.append(h2('Hardware & Software'))
    story.append(bullet('Linux server: Ubuntu 22.04 LTS (recommended) or RHEL 8+'))
    story.append(bullet('Docker Engine 24+ and Docker Compose v2'))
    story.append(bullet('Minimum 4 CPU cores, 8GB RAM, 50GB SSD'))
    story.append(bullet('HSM with PKCS#11 interface (see supported HSMs below)'))
    story.append(sp())
    story.append(h2('Supported HSMs'))

    hsm_data = [
        ['HSM', 'Library Path', 'Use Case'],
        ['Thales Luna Network HSM 7', '/usr/lib/libCryptoki2_64.so', 'Production (on-prem)'],
        ['Thales Luna DPoD', '/opt/lunaclient/libs/64/libCryptoki2.so', 'Production (cloud HSM)'],
        ['AWS CloudHSM', '/opt/cloudhsm/lib/libcloudhsm_pkcs11.so', 'Production (AWS)'],
        ['SoftHSM2', '/usr/lib/softhsm/libsofthsm2.so', 'Development/Testing ONLY'],
    ]
    t = Table(hsm_data, colWidths=[1.8*inch, 2.5*inch, 1.7*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(sp())

    story.append(h2('Network Requirements'))

    port_data = [
        ['Port', 'Service', 'Direction', 'Access'],
        ['3100', 'Blue Driver Dashboard', 'Inbound', 'Admin workstation only'],
        ['3200', 'Driver Internal API (mTLS)', 'Internal', 'Blue Console ONLY'],
        ['3300', 'Blue Console Bank API', 'Inbound', 'Bank applications'],
        ['3400', 'Blue Console Ops Dashboard', 'Inbound', 'Operations team'],
        ['5432', 'PostgreSQL', 'Internal', 'Blue Driver ONLY'],
    ]
    t = Table(port_data, colWidths=[0.6*inch, 2.2*inch, 0.9*inch, 2.3*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(pb())

    # ── 3. NETWORK ARCHITECTURE ──
    story.append(h1('3. Network Architecture'))
    story.append(divider())
    story.append(sp())
    story.append(code(
        '    SECURE ZONE (No Internet)          DMZ (Internet Access)\n'
        '    +-------------------------+        +------------------------+\n'
        '    |                         |        |                        |\n'
        '    |  Blue Driver            |  mTLS  |  Blue Console          |\n'
        '    |  :3100 Dashboard        |<------>|  :3300 Bank API        |-->RPC\n'
        '    |  :3200 Internal API     | :3200  |  :3400 Ops Dashboard   |\n'
        '    |                         |        |                        |\n'
        '    |  Luna HSM (PKCS#11)     |        |  Compliance APIs       |\n'
        '    |  PostgreSQL :5432       |        |  (TRM, Chainalysis)    |\n'
        '    |                         |        |                        |\n'
        '    +-------------------------+        +------------------------+\n'
        '         internal network               internal + internet'
    ))
    story.append(sp())
    story.append(h2('Firewall Rules'))
    story.append(bullet('<b>Port 3200:</b> BLOCK all inbound except Blue Console container IP'))
    story.append(bullet('<b>Port 5432:</b> BLOCK all inbound except Blue Driver container'))
    story.append(bullet('<b>Port 3100:</b> Allow from admin workstation IPs only'))
    story.append(bullet('<b>Port 3300/3400:</b> Allow from bank application servers and operator workstations'))
    story.append(bullet('<b>Outbound from Console:</b> Allow HTTPS to RPC nodes and compliance vendor APIs'))
    story.append(bullet('<b>Outbound from Driver:</b> BLOCK ALL (air-gapped)'))
    story.append(pb())

    # ── 4. PULL IMAGES ──
    story.append(h1('4. Step 1: Pull Docker Images'))
    story.append(divider())
    story.append(sp())
    story.append(p('Pull the pre-built Docker images from GitHub Container Registry:'))
    story.append(sp())
    story.append(code(
        '$ docker pull ghcr.io/khansufyaan/blue-driver:latest\n'
        '$ docker pull ghcr.io/khansufyaan/blue-console:latest'
    ))
    story.append(sp())
    story.append(p('PostgreSQL 16 Alpine is pulled automatically by Docker Compose.'))
    story.append(sp())
    story.append(note('Verify image integrity with: docker inspect --format=\'{{.RepoDigests}}\' <image>'))
    story.append(pb())

    # ── 5. GENERATE CERTS ──
    story.append(h1('5. Step 2: Generate mTLS Certificates'))
    story.append(divider())
    story.append(sp())
    story.append(p(
        'Mutual TLS certificates authenticate the Console to the Driver. Without a valid '
        'client certificate, the Driver rejects all connections on port 3200.'
    ))
    story.append(sp())
    story.append(code(
        '$ git clone https://github.com/khansufyaan/BLUEWALLETS.git\n'
        '$ cd BLUEWALLETS\n'
        '$ chmod +x certs/generate-certs.sh\n'
        '$ ./certs/generate-certs.sh'
    ))
    story.append(sp())
    story.append(p('This generates the following files in the <font color="#60A5FA">certs/</font> directory:'))
    story.append(sp(4))

    cert_data = [
        ['File', 'Purpose', 'Used By'],
        ['ca.pem', 'Internal Certificate Authority', 'Both Driver and Console'],
        ['ca-key.pem', 'CA private key (keep secure!)', 'Certificate generation only'],
        ['driver-cert.pem', 'Driver server certificate', 'Blue Driver'],
        ['driver-key.pem', 'Driver server private key', 'Blue Driver'],
        ['console-cert.pem', 'Console client certificate', 'Blue Console'],
        ['console-key.pem', 'Console client private key', 'Blue Console'],
    ]
    t = Table(cert_data, colWidths=[1.5*inch, 2.5*inch, 2*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(sp())
    story.append(warn('NEVER commit .pem files to version control. The .gitignore excludes them by default.'))
    story.append(warn('Store ca-key.pem in a secure vault. It can mint new certificates.'))
    story.append(pb())

    # ── 6. CONFIGURE ENV ──
    story.append(h1('6. Step 3: Configure Environment'))
    story.append(divider())
    story.append(sp())
    story.append(p('Create a <font color="#60A5FA">.env</font> file in the project root:'))
    story.append(sp())
    story.append(code(
        '# .env\n'
        'POSTGRES_PASSWORD=<strong-random-password-here>\n'
        'INTERNAL_AUTH_KEY=<64-character-random-string>\n'
        'ETH_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-api-key>\n'
        'WEBHOOK_URL=https://your-bank.com/api/deposit-webhook'
    ))
    story.append(sp())

    env_data = [
        ['Variable', 'Required', 'Description'],
        ['POSTGRES_PASSWORD', 'Yes', 'PostgreSQL database password'],
        ['INTERNAL_AUTH_KEY', 'Yes', 'Shared secret for Driver-Console auth (belt+suspenders with mTLS)'],
        ['ETH_RPC_URL', 'Yes', 'Ethereum RPC endpoint (Alchemy, Infura, or QuickNode)'],
        ['WEBHOOK_URL', 'No', 'URL to receive deposit notifications via POST'],
        ['ETH_CHAIN_ID', 'No', 'Chain ID (default: 11155111 for Sepolia testnet)'],
    ]
    t = Table(env_data, colWidths=[1.5*inch, 0.8*inch, 3.7*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(sp())
    story.append(p('Generate a strong random key:'))
    story.append(code('$ openssl rand -hex 32'))
    story.append(pb())

    # ── 7. MOUNT HSM ──
    story.append(h1('7. Step 4: Mount HSM'))
    story.append(divider())
    story.append(sp())
    story.append(p(
        'The Blue Driver container needs access to your HSM\'s PKCS#11 shared library. '
        'Mount the library directory into the container.'
    ))
    story.append(sp())
    story.append(h3('Luna HSM (On-Premises)'))
    story.append(p('Add to docker-compose under blue-driver volumes:'))
    story.append(code('volumes:\n  - /usr/lib:/usr/lib:ro    # Contains libCryptoki2_64.so'))
    story.append(sp())
    story.append(h3('Luna DPoD (Cloud HSM)'))
    story.append(code(
        'volumes:\n'
        '  - /opt/lunaclient:/opt/lunaclient:ro\n'
        '  - ./certs:/app/certs:ro'
    ))
    story.append(sp())
    story.append(h3('AWS CloudHSM'))
    story.append(code(
        'volumes:\n'
        '  - /opt/cloudhsm:/opt/cloudhsm:ro\n'
        '  - ./certs:/app/certs:ro'
    ))
    story.append(sp())
    story.append(h3('SoftHSM2 (Development Only)'))
    story.append(code(
        '# Initialize token first:\n'
        '$ softhsm2-util --init-token --slot 0 --label "blue-dev" \\\n'
        '    --pin 1234 --so-pin 5678\n'
        '\n'
        'volumes:\n'
        '  - /usr/lib/softhsm:/usr/lib/softhsm:ro\n'
        '  - /var/lib/softhsm/tokens:/var/lib/softhsm/tokens'
    ))
    story.append(warn('SoftHSM2 is NOT FIPS certified. Use only for development and testing.'))
    story.append(pb())

    # ── 8. START SERVICES ──
    story.append(h1('8. Step 5: Start Services'))
    story.append(divider())
    story.append(sp())
    story.append(code(
        '$ docker compose -f docker-compose.client.yml up -d\n'
        '\n'
        '# Verify all services are running:\n'
        '$ docker compose -f docker-compose.client.yml ps\n'
        '\n'
        '# Expected output:\n'
        '# NAME              STATUS         PORTS\n'
        '# postgres          Up (healthy)   5432/tcp\n'
        '# blue-driver       Up (healthy)   3100, 3200\n'
        '# blue-console      Up (healthy)   3300, 3400'
    ))
    story.append(sp())
    story.append(p('Check startup logs for errors:'))
    story.append(code(
        '$ docker compose logs blue-driver --tail 20\n'
        '$ docker compose logs blue-console --tail 20'
    ))
    story.append(sp())
    story.append(p('Look for these success messages:'))
    story.append(note('Blue Driver: "Internal API running on port 3200 (mTLS enabled)"'))
    story.append(note('Blue Console: "Driver proxy: mTLS agent created with client certificates"'))
    story.append(note('Blue Console: "Signer connection verified"'))
    story.append(pb())

    # ── 9. KEY CEREMONY ──
    story.append(h1('9. Step 6: Key Ceremony'))
    story.append(divider())
    story.append(sp())
    story.append(p(
        'The Key Ceremony is a one-time initialization that creates the master wrap key '
        'on the HSM. This key is used to encrypt all wallet private keys.'
    ))
    story.append(sp())
    story.append(h3('Step 1: Connect HSM'))
    story.append(bullet('Open <font color="#60A5FA">http://localhost:3100</font> in your browser'))
    story.append(bullet('Login with: admin / Admin1234!'))
    story.append(bullet('Select your HSM provider (Luna HSM, SoftHSM2, etc.)'))
    story.append(bullet('Enter the PKCS#11 library path'))
    story.append(bullet('Enter the slot index (typically 0)'))
    story.append(bullet('Enter the HSM PIN'))
    story.append(bullet('Click <b>Connect</b> &mdash; watch the 4-step connection animation'))
    story.append(sp())
    story.append(h3('Step 2: Generate Master Key'))
    story.append(bullet('Click <b>Generate Master Key on HSM</b>'))
    story.append(bullet('This creates <font color="#60A5FA">blue:wrap:v1</font> (AES-256) inside the HSM'))
    story.append(bullet('Key attributes: CKA_SENSITIVE=true, CKA_EXTRACTABLE=false, CKA_TOKEN=true'))
    story.append(bullet('This key can NEVER be extracted from the HSM'))
    story.append(sp())
    story.append(h3('Step 3: End-to-End Verification'))
    story.append(p('The system automatically verifies the entire pipeline:'))
    story.append(note('Database Connected &mdash; PostgreSQL accessible'))
    story.append(note('Master Wrap Key Verified &mdash; blue:wrap:v1 found on HSM'))
    story.append(note('Test Wallet Created &mdash; EC secp256k1 keypair generated + stored'))
    story.append(note('Private Key Secured &mdash; Key reference stored in database'))
    story.append(pb())

    # ── 10. CONSOLE SETUP ──
    story.append(h1('10. Step 7: Console Setup'))
    story.append(divider())
    story.append(sp())
    story.append(bullet('Open <font color="#60A5FA">http://localhost:3400</font> (Blue Console)'))
    story.append(bullet('Login with: admin / Admin1234!'))
    story.append(sp())
    story.append(h3('Create Organizational Structure'))
    story.append(bullet('<b>Vaults</b> &mdash; Create vaults to group wallets (e.g., "Treasury", "Client Funds")'))
    story.append(bullet('<b>Wallets</b> &mdash; Create wallets inside vaults. Each wallet gets a unique Ethereum address.'))
    story.append(bullet('<b>Policies</b> &mdash; Set spending limits, velocity rules, whitelists/blacklists'))
    story.append(bullet('<b>Roles</b> &mdash; Assign Admin, Operator, Compliance, or Auditor roles'))
    story.append(sp())
    story.append(h3('Configure Integrations (Settings Page)'))
    story.append(bullet('RPC Node: Enter your Alchemy/Infura API key for Ethereum'))
    story.append(bullet('TRM Labs: Enter API key for sanctions screening'))
    story.append(bullet('Chainalysis KYT: Enter API key for risk scoring'))
    story.append(bullet('Notabene: Enter API key for Travel Rule compliance'))
    story.append(pb())

    # ── 11. SECURITY CHECKLIST ──
    story.append(h1('11. Post-Deployment Security Checklist'))
    story.append(divider())
    story.append(sp())

    checklist = [
        'Change ALL default passwords immediately',
        'Generate a strong INTERNAL_AUTH_KEY (openssl rand -hex 32)',
        'Firewall: restrict port 3200 to Console container IP only',
        'Firewall: restrict port 5432 to Driver container only',
        'Firewall: block ALL outbound traffic from Blue Driver',
        'Configure HSM PIN complexity and rotation policy',
        'Rotate mTLS certificates before expiry (365 days)',
        'Schedule PostgreSQL backups (pg_dump) — daily minimum',
        'Test backup restoration procedure',
        'Enable audit log monitoring and SIEM integration',
        'Set up alerting for failed login attempts',
        'Review RBAC roles and remove unnecessary permissions',
        'Configure compliance API keys and test screening',
        'Document your HSM backup/recovery procedure',
    ]
    for item in checklist:
        story.append(Paragraph(
            f'<font color="#64748B">&#9744;</font>  {item}',
            styles['body']
        ))
    story.append(pb())

    # ── 12. DEFAULT CREDENTIALS ──
    story.append(h1('12. Default Credentials'))
    story.append(divider())
    story.append(sp())
    story.append(warn('CHANGE ALL CREDENTIALS ON FIRST LOGIN. These are development defaults only.'))
    story.append(sp())

    cred_data = [
        ['Username', 'Password', 'Role', 'Access Level'],
        ['admin', 'Admin1234!', 'Admin', 'Full access — create, approve, delete, assign'],
        ['officer1', 'Officer1234!', 'Operator', 'Initiate transactions and create resources'],
        ['officer2', 'Officer1234!', 'Operator', 'Same as officer1'],
        ['auditor', 'Auditor1234!', 'Auditor', 'Read-only access with full audit trail visibility'],
    ]
    t = Table(cred_data, colWidths=[1*inch, 1.3*inch, 1*inch, 2.7*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY_LIGHT),
        ('TEXTCOLOR', (0, 0), (-1, 0), BLUE_400),
        ('TEXTCOLOR', (0, 1), (-1, -1), SLATE_300),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Courier'),
        ('FONTNAME', (2, 1), (2, -1), 'Helvetica'),
        ('FONTNAME', (3, 1), (3, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [NAVY_DARK, NAVY]),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(pb())

    # ── 13. TROUBLESHOOTING ──
    story.append(h1('13. Troubleshooting'))
    story.append(divider())
    story.append(sp())

    issues = [
        ('HSM Disconnected', 'Verify PKCS#11 library path is correct and accessible inside the container. '
         'Check HSM PIN. Ensure the HSM device/service is running.'),
        ('mTLS Handshake Failed', 'Regenerate certificates with ./certs/generate-certs.sh. '
         'Verify certs are mounted at /app/certs in both containers. Check certificate expiry dates.'),
        ('Console Cannot Reach Driver', 'Verify SIGNER_URL=https://blue-driver:3200 in Console env. '
         'Check both containers are on the same Docker network. Test: docker exec blue-console curl https://blue-driver:3200/health'),
        ('Database Connection Failed', 'Verify POSTGRES_PASSWORD matches in .env and compose file. '
         'Check PostgreSQL container is healthy: docker compose ps postgres'),
        ('RPC Rate Limited (429)', 'Replace the demo Alchemy API key with a paid tier key. '
         'The demo key is severely rate-limited and will cause deposit monitoring failures.'),
        ('Key Ceremony Fails', 'Ensure HSM is connected first (Step 1). Check HSM PIN is correct. '
         'Verify the PKCS#11 library supports CKM_AES_KEY_GEN mechanism.'),
        ('Wallet Creation Fails', 'Ensure Key Ceremony completed successfully. Verify HSM session is active. '
         'Check Driver logs for specific PKCS#11 error codes.'),
    ]

    for title, fix in issues:
        story.append(h3(title))
        story.append(p(fix))
        story.append(sp(4))

    # ── BACK COVER ──
    story.append(pb())
    story.append(Spacer(1, 200))
    story.append(Paragraph(
        '<font color="#60A5FA" size="20"><b>Blue Wallets</b></font>',
        ParagraphStyle('center', alignment=TA_CENTER, spaceAfter=8)
    ))
    story.append(Paragraph(
        '<font color="#94A3B8" size="11">Institutional-Grade Digital Asset Custody</font>',
        ParagraphStyle('center2', alignment=TA_CENTER, spaceAfter=24)
    ))
    story.append(Paragraph(
        '<font color="#64748B" size="9">For support and inquiries: contact@bluewallets.io</font>',
        ParagraphStyle('center3', alignment=TA_CENTER, spaceAfter=4)
    ))
    story.append(Paragraph(
        '<font color="#64748B" size="9">https://github.com/khansufyaan/BLUEWALLETS</font>',
        ParagraphStyle('center4', alignment=TA_CENTER)
    ))

    return story


# ── Build PDF ─────────────────────────────────────────────────

def build():
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=letter,
        topMargin=54,
        bottomMargin=54,
        leftMargin=54,
        rightMargin=54,
        title='Blue Wallets — On-Premises Deployment Guide',
        author='Blue Wallets',
        subject='Deployment Guide for Bank Infrastructure Teams',
    )

    story = build_content()

    # Build with page templates
    doc.build(
        story,
        onFirstPage=cover_page,
        onLaterPages=page_template,
    )
    print(f'PDF generated: {OUTPUT}')


if __name__ == '__main__':
    build()
