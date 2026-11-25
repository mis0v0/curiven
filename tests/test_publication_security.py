"""Small offline checks for imported documents and authenticated Notion transport."""
import codecs
import io
import threading
import unittest
import zipfile
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

import material
from material import extract_pptx, MaterialError
from notion_link import MemoryStore, NotionError, NotionLink
from tests.material_fixtures import build_pptx


class PowerPoint(unittest.TestCase):
    def package(self, encoding, dtd=False, malformed=False, part=None):
        original = build_pptx(['synthetic slide'], dtd=dtd)
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original)) as src, zipfile.ZipFile(output, 'w') as dest:
            for name in src.namelist():
                if part and name != part:
                    dest.writestr(name, src.read(name))
                    continue
                text = src.read(name).decode().replace('UTF-8', encoding.upper())
                if malformed and name.endswith('slide1.xml'):
                    text = text[:-3]
                dest.writestr(name, text.encode(encoding))
        return output.getvalue()

    def test_package_encodings(self):
        for enc in ('utf-8', 'utf-16', 'utf-16le', 'utf-16be'):
            with self.subTest(enc=enc):
                self.assertIn('synthetic slide', str(extract_pptx(self.package(enc))))
                for kwargs in ({'dtd': True}, {'malformed': True}):
                    with self.assertRaises(MaterialError) as err:
                        extract_pptx(self.package(enc, **kwargs))
                    self.assertEqual(err.exception.status, 422)
        with self.assertRaises(MaterialError):
            extract_pptx(self.package('utf-32'))

    def test_prohibited_declaration_in_mixed_encoding_package(self):
        # The manifest and slide stay ordinary UTF-8. Only the presentation
        # part changes encoding, so an unrelated format error cannot pass.
        part = 'ppt/presentation.xml'
        self.assertIn('synthetic slide', str(extract_pptx(self.package('utf-16', part=part))))
        with self.assertRaises(MaterialError) as err:
            extract_pptx(self.package('utf-16', dtd=True, part=part))
        self.assertEqual(err.exception.status, 422)
        self.assertIn('DTD', err.exception.message)


    def slide(self, raw, **other):
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(build_pptx(['synthetic slide']))) as src, zipfile.ZipFile(output, 'w') as dest:
            for name in src.namelist():
                dest.writestr(name, raw if name.endswith('slide1.xml') else other.get(name, src.read(name)))
        return output.getvalue()

    def test_encoding_declaration_and_bytes_must_agree(self):
        with zipfile.ZipFile(io.BytesIO(build_pptx(['synthetic slide']))) as src:
            body = src.read('ppt/slides/slide1.xml').decode().split('?>', 1)[1]
        decl = '<?xml version="1.0" encoding="{}"?>'.format
        text = lambda enc, declared: (decl(declared) + body).encode(enc)
        accepted = [body.encode(), codecs.BOM_UTF8 + text('utf-8', 'utf-8'), text('ascii', 'US-ASCII'),
                    codecs.BOM_UTF16_BE + text('utf-16-be', 'UTF-16'), body.encode('utf-16-le')]
        refused = [text('utf-8', 'UTF-16'), text('latin1', 'ISO-8859-1'), codecs.BOM_UTF8 + text('utf-8', 'ISO-8859-1'),
                   codecs.BOM_UTF16_LE + text('utf-16-le', 'UTF-16BE'), codecs.BOM_UTF16_LE + text('utf-16-le', 'UTF-8'),
                   (decl('US-ASCII') + body.replace('synthetic', '합성')).encode(),
                   body.encode().replace(b'synthetic', b'\xff\xfe'), body.encode('utf-16-le')[:-1],
                   body.replace('synthetic', 'syn\0thetic').encode(), text('utf-32', 'UTF-32'), b'']
        for raw in accepted:
            self.assertIn('synthetic slide', str(extract_pptx(self.slide(raw))), raw[:40])
        for raw in refused:
            with self.assertRaises(MaterialError, msg=raw[:40]) as err: extract_pptx(self.slide(raw))
            self.assertEqual(err.exception.status, 422)
        # The parser gets the inspected text, never the original bytes; undecodable input never reaches it.
        with mock.patch.object(material.ET, 'fromstring', wraps=material.ET.fromstring) as parse:
            extract_pptx(self.package('utf-16'))
            self.assertEqual({type(c.args[0]) for c in parse.call_args_list}, {str})
            parse.reset_mock()
            for raw in (body.encode().replace(b'synthetic', b'\xff\xfe'), body.replace('synthetic', 'syn\0thetic').encode()):
                with self.assertRaises(MaterialError): extract_pptx(self.slide(raw))
            self.assertFalse([c for c in parse.call_args_list if 'thetic' in c.args[0] or '\ufffd' in c.args[0]])

    def test_macro_manifest_and_part_size_limits(self):
        with zipfile.ZipFile(io.BytesIO(build_pptx(['synthetic slide']))) as src:
            types = src.read('[Content_Types].xml').decode()
        macro = types.replace('</Types>', '<Override PartName="/m" ContentType="application/x.macroEnabled"/></Types>')
        for enc in ('utf-8', 'utf-16'):
            package = self.slide(b'<a/>', **{'[Content_Types].xml': macro.replace('UTF-8', enc).encode(enc)})
            with self.assertRaises(MaterialError) as err: extract_pptx(package)
            self.assertEqual(err.exception.status, 415)
        with mock.patch.object(material, 'ZIP_PART', 100):
            with self.assertRaises(MaterialError) as err: extract_pptx(build_pptx(['synthetic slide']))
            self.assertEqual(err.exception.status, 413)


@contextmanager
def endpoint(handler):
    with HTTPServer(('127.0.0.1', 0), handler) as http:
        thread = threading.Thread(target=http.serve_forever, kwargs={'poll_interval': 0.02})
        thread.start()
        try:
            yield 'http://127.0.0.1:' + str(http.server_port)
        finally:
            http.shutdown()
            thread.join()


class Redirects(unittest.TestCase):
    def test_every_method_refuses_every_redirect(self):
        source, destination, location, base_url = [], [], ['cross'], ['']

        class Sink(BaseHTTPRequestHandler):
            def log_message(self, *args): pass

            def handle_request(self):
                destination.append(self.command)
                self.send_response(200)
                self.end_headers()

            do_GET = do_POST = do_PATCH = handle_request

        with endpoint(Sink) as other:
            class Origin(Sink):
                def handle_request(self):
                    if self.path == '/unused': destination.append(self.command)
                    source.append((self.command, self.headers.get('Authorization') == 'Bearer fixture'))
                    self.send_response(int(self.path[1:]) if self.path[1:].isdigit() else 200)
                    target = {'cross': other, 'same': base_url[0], 'relative': ''}[location[0]]
                    self.send_header('Location', target + '/unused')
                    self.end_headers()

                do_GET = do_POST = do_PATCH = handle_request

            with endpoint(Origin) as base:
                base_url[0] = base
                link = NotionLink(base=base, store=MemoryStore())
                for location[0] in ('cross', 'same', 'relative'):
                    for method in ('GET', 'POST', 'PATCH'):
                        for status in (301, 302, 303, 307, 308):
                            with self.subTest(location=location[0], method=method, status=status):
                                with self.assertRaises(NotionError) as err:
                                    link._call(method, '/' + str(status), token='fixture')
                                self.assertEqual(err.exception.code, 'redirect_refused')
                                self.assertEqual(source[-1], (method, True))
                                self.assertEqual(destination, [])
